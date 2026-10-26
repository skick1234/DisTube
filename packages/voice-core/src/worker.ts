import { parentPort } from "node:worker_threads";
import {
  AV_CH_LAYOUT_STEREO,
  AV_CHANNEL_ORDER_NATIVE,
  AV_CODEC_ID_OPUS,
  AV_LOG_QUIET,
  AV_NOPTS_VALUE,
  AV_SAMPLE_FMT_S16,
  AVERROR_EOF,
  AVERROR_EXIT,
  AVERROR_INVALIDDATA,
  AVSEEK_FLAG_BACKWARD,
  avSamplesGetBufferSize,
  type CodecContext,
  Decoder,
  Demuxer,
  Encoder,
  FF_ENCODER_LIBOPUS,
  FFmpegError,
  FilterAPI,
  Frame,
  Log,
  Packet,
  type Stream,
} from "node-av";
import type { InputSource, ToWorker, WireError } from "./protocol.ts";
import {
  type ByteSource,
  FileSource,
  OneShotSource,
  post,
  RangedSource,
  RemoteSource,
  remotes,
} from "./worker-input.ts";

const OUTPUT_FORMAT = "aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo";
const VOLUME_FILTER = "volume@distube";
const IO_BUFFER_BYTES = 16 * 1024;
const BATCH_PACKETS = 5;
const AUDIO_CONTAINERS = new Set(["matroska", "mov", "ogg", "mp3", "flac", "wav", "aac"]);
const FORMAT_WHITELIST = [...AUDIO_CONTAINERS].join(",");

const port = parentPort;
const pipelines = new Map<number, Pipeline>();
const grants = new Map<number, () => void>();
let nextPermit = 0;

async function withPermit<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const permit = ++nextPermit;
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        grants.delete(permit);
        reject(signal.reason);
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      grants.set(permit, () => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
      post({ type: "acquire", permit });
    });
    return await work();
  } finally {
    post({ type: "release", permit });
  }
}

function wire(value: unknown, withCause = true): WireError {
  if (!(value instanceof Error)) return { name: "Error", message: "Non-error cause" };
  const code = value instanceof FFmpegError ? value.code : (value as { code?: unknown }).code;
  return {
    name: value.name,
    message: value.message,
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(withCause && value.cause !== undefined ? { cause: wire(value.cause, false) } : {}),
  };
}

class Input {
  readonly id: number;
  readonly stream: Stream;
  readonly opus: boolean;
  readonly bitRate: number | undefined;
  readonly start: number;
  readonly #track: number;
  readonly #demuxer: Demuxer;
  readonly #source: ByteSource;
  #reading?: Promise<number>;
  #closing?: Promise<void>;

  constructor(track: number, id: number, demuxer: Demuxer, stream: Stream, source: ByteSource, start: number) {
    this.#track = track;
    this.id = id;
    this.#demuxer = demuxer;
    this.stream = stream;
    this.#source = source;
    this.start = start;
    const { codecpar } = stream;
    this.opus = codecpar.codecId === AV_CODEC_ID_OPUS && codecpar.sampleRate === 48_000 && codecpar.channels === 2;
    const known = [codecpar.bitRate, demuxer.getFormatContext().bitRate].find(rate => rate > 0n);
    this.bitRate = known === undefined ? undefined : Math.min(Math.max(Number(known), 6_000), 510_000);
  }

  get failure(): Error | undefined {
    return this.#source.failure;
  }

  waiting(): boolean {
    return this.#source.waiting();
  }

  async read(packet: Packet): Promise<number> {
    if (this.#closing) return AVERROR_EXIT;
    const reading = this.#demuxer.getFormatContext().readFrame(packet);
    this.#reading = reading;
    const result = await reading;
    this.#reading = undefined;
    return result;
  }

  close(): Promise<void> {
    this.#closing ??= (async () => {
      await this.#source.close();
      await this.#reading?.catch(() => undefined);
      await this.#demuxer.close().catch(() => undefined);
      post({ type: "retired", track: this.#track, input: this.id });
    })();
    return this.#closing;
  }
}

async function openInput(
  track: number,
  id: number,
  source: InputSource,
  seconds: number,
  signal: AbortSignal,
): Promise<Input> {
  const bytes =
    source.kind === "file"
      ? await FileSource.open(source.path)
      : source.kind === "ranged"
        ? new RangedSource(track, id, source.size)
        : new OneShotSource(track, id);
  let demuxer: Demuxer | undefined;
  const abort = (): void => void bytes.close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (bytes instanceof RemoteSource) await bytes.prefill();
    signal.throwIfAborted();
    if (bytes.failure) throw bytes.failure;
    const container = source.kind === "file" ? undefined : source.container;
    const format = container ? (container === "mp4" ? "mp4" : "matroska") : probedFormat(await bytes.probe(), bytes);
    demuxer = await withPermit(signal, async () => {
      const opened = await Demuxer.open(bytes.callbacks, {
        format,
        bufferSize: IO_BUFFER_BYTES,
        options: { format_whitelist: FORMAT_WHITELIST },
        signal,
      });
      try {
        if (seconds > 0 && source.kind !== "oneshot") {
          FFmpegError.throwIfError(await opened.seek(seconds, -1, AVSEEK_FLAG_BACKWARD), "Seek failed");
        }
        return opened;
      } catch (error: unknown) {
        await opened.close().catch(() => undefined);
        throw error;
      }
    });
    const stream = demuxer.audio();
    if (!stream) throw new Error("Playback input has no audio stream");
    return new Input(track, id, demuxer, stream, bytes, seconds);
  } catch (error: unknown) {
    if (bytes instanceof RangedSource) await bytes.settled();
    await bytes.close();
    await demuxer?.close().catch(() => undefined);
    post({ type: "retired", track, input: id });
    throw bytes.failure ?? error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function probedFormat(head: Buffer, source: ByteSource): string {
  const probed = Demuxer.probeFormatSync(head);
  const name = probed?.format.split(",", 1)[0];
  if (!name) throw source.failure ?? new FFmpegError(AVERROR_INVALIDDATA);
  if (!AUDIO_CONTAINERS.has(name)) {
    throw Object.assign(new Error(`Playback input is ${name}, not a single-file audio container`), {
      code: "SOURCE_FAILED",
    });
  }
  return name;
}

/** Whether one Opus packet holds exactly 20 ms, read from its TOC byte (RFC 6716, section 3.1). */
function twentyMsOpus(packet: Buffer): boolean {
  const toc = packet[0];
  if (toc === undefined) return false;
  const config = toc >> 3;
  const frameMs =
    config < 12 ? [10, 20, 40, 60][config & 3] : config < 16 ? [10, 20][config & 1] : [2.5, 5, 10, 20][config & 3];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 0x3f;
  return frameMs !== undefined && frameMs * frames === 20;
}

function graph(chain: string | undefined, volume: number): string {
  return `aresample=48000,${chain ? `${chain},` : ""}${VOLUME_FILTER}=${volume / 100},${OUTPUT_FORMAT}`;
}

const DEFAULT_LAYOUT = { nbChannels: 2, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_STEREO };

function silentSample(context: CodecContext | null): Frame {
  const known =
    context !== null && context.sampleFormat >= 0 && context.sampleRate > 0 && context.channelLayout.nbChannels > 0;
  const format = known ? context.sampleFormat : AV_SAMPLE_FMT_S16;
  const sampleRate = known ? context.sampleRate : 48_000;
  const channelLayout = known ? context.channelLayout : DEFAULT_LAYOUT;
  const { size } = avSamplesGetBufferSize(channelLayout.nbChannels, 1, format, 1);
  return Frame.fromAudioBuffer(Buffer.alloc(size), {
    nbSamples: 1,
    format,
    sampleRate,
    channelLayout,
    timeBase: { num: 1, den: sampleRate },
  });
}

/** FilterAPI builds its graph on the first frame, so one silent sample builds it now and a bad chain fails here. */
function checkedFilter(description: () => string, context: CodecContext | null): FilterAPI {
  const filter = FilterAPI.create(description);
  const sample = silentSample(context);
  try {
    for (const frame of filter.processAllSync(sample)) frame.free();
    return filter;
  } catch (error: unknown) {
    filter.close();
    throw Object.assign(new Error("Filter chain could not be applied", { cause: error }), {
      code: "INVALID_ARGUMENT",
    });
  } finally {
    sample.free();
  }
}

interface Transcoder {
  decoder: Decoder;
  filter: FilterAPI;
  encoder: Encoder;
  bitrate: number;
}

interface Candidate {
  readonly input: Input;
  readonly first?: Packet;
}

class Pipeline {
  readonly id: number;
  readonly #packet = new Packet();
  readonly #joins = new Set<Promise<unknown>>();
  #input?: Input;
  #held?: Packet;
  #transcoder?: Transcoder;
  #volume: number;
  #chain: string | undefined;
  #target: number;
  readonly #complexity: number;
  #position = 0;
  #credit = 0;
  #batch: ArrayBuffer[] = [];
  #batchPts: number[] = [];
  #opening?: AbortController;
  #seeking?: AbortController;
  #pumping?: Promise<void>;
  #drained = false;
  #ended = false;
  #failed = false;
  #closed = false;

  constructor(id: number, volume: number, chain: string | undefined, bitrate: number, complexity: number) {
    this.id = id;
    this.#volume = volume;
    this.#chain = chain;
    this.#target = bitrate;
    this.#complexity = complexity;
    this.#packet.alloc();
  }

  async open(input: number, source: InputSource): Promise<void> {
    const controller = new AbortController();
    this.#opening = controller;
    try {
      const opened = await this.#join(openInput(this.id, input, source, 0, controller.signal));
      if (this.#closed) {
        this.#join(opened.close());
        return;
      }
      this.#input = opened;
      if (!opened.opus || this.#chain !== undefined || this.#volume !== 100) {
        this.#transcoder = this.#createTranscoder();
      }
      post({ type: "opened", track: this.id });
      this.#kick();
    } catch (error: unknown) {
      if (!this.#closed) this.fail("open", error, input);
    } finally {
      this.#opening = undefined;
    }
  }

  credit(count: number): void {
    this.#credit += count;
    this.#kick();
  }

  setVolume(percent: number): void {
    this.#volume = percent;
    const filter = this.#transcoder?.filter;
    if (filter?.isFilterInitialized) filter.sendCommand(VOLUME_FILTER, "volume", String(percent / 100));
    this.#kick();
  }

  setFilters(request: number, chain: string | undefined): void {
    const previous = this.#chain;
    this.#chain = chain;
    try {
      const transcoder = this.#transcoder;
      if (transcoder) {
        const filter = this.#createFilter(transcoder.decoder);
        transcoder.filter.close();
        transcoder.filter = filter;
      } else if (chain !== undefined && this.#input) {
        this.#transcoder = this.#createTranscoder();
      }
    } catch (error: unknown) {
      this.#chain = previous;
      post({ type: "settled", track: this.id, request, error: wire(error) });
      return;
    }
    post({ type: "settled", track: this.id, request });
    this.#kick();
  }

  setBitrate(bitrate: number): void {
    this.#target = bitrate;
  }

  async seek(request: number, input: number, source: InputSource, seconds: number): Promise<void> {
    this.#seeking?.abort();
    const controller = new AbortController();
    this.#seeking = controller;
    let candidate: Candidate;
    try {
      candidate = await this.#join(this.#prepare(input, source, seconds, controller.signal));
    } catch (error: unknown) {
      if (this.#seeking === controller) {
        this.#seeking = undefined;
        if (this.#drained && !this.#closed) this.#guard("decode", () => this.#finish());
      }
      const superseded = controller.signal.aborted;
      post({
        type: "settled",
        track: this.id,
        request,
        input,
        ...(superseded ? { superseded } : { error: wire(error) }),
      });
      return;
    }
    if (controller.signal.aborted || this.#closed || this.#failed) {
      candidate.first?.free();
      this.#retire(candidate.input);
      post({ type: "settled", track: this.id, request, superseded: true });
      return;
    }
    this.#seeking = undefined;
    try {
      this.#switch(candidate);
    } catch (error: unknown) {
      if (this.#held !== candidate.first) candidate.first?.free();
      this.fail("seek", error, input);
      post({ type: "settled", track: this.id, request, input, error: wire(error) });
      return;
    }
    post({ type: "settled", track: this.id, request, position: this.#position });
    this.#kick();
  }

  #guard(stage: string, work: () => void): void {
    try {
      work();
    } catch (error: unknown) {
      this.fail(stage, error);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#opening?.abort();
    this.#seeking?.abort();
    if (this.#input) this.#retire(this.#input);
    await this.#pumping;
    while (this.#joins.size > 0) await Promise.allSettled(this.#joins);
    this.#dropTranscoder();
    this.#held?.free();
    this.#held = undefined;
    this.#packet.free();
    pipelines.delete(this.id);
    post({ type: "closed", track: this.id });
  }

  #join<T>(work: Promise<T>): Promise<T> {
    this.#joins.add(work);
    const forget = (): void => {
      this.#joins.delete(work);
    };
    work.then(forget, forget);
    return work;
  }

  async #prepare(input: number, source: InputSource, seconds: number, signal: AbortSignal): Promise<Candidate> {
    const opened = await openInput(this.id, input, source, seconds, signal);
    const packet = new Packet();
    packet.alloc();
    try {
      for (;;) {
        const result = await opened.read(packet);
        signal.throwIfAborted();
        if (result === AVERROR_EOF) {
          packet.free();
          return { input: opened };
        }
        if (result < 0) throw opened.failure ?? new FFmpegError(result);
        if (packet.streamIndex === opened.stream.index && this.#endSeconds(packet, opened) > opened.start) {
          return { input: opened, first: packet };
        }
        packet.unref();
      }
    } catch (error: unknown) {
      packet.free();
      await opened.close();
      throw error;
    }
  }

  #switch({ input, first }: Candidate): void {
    this.#flush();
    if (this.#input) this.#retire(this.#input);
    this.#input = input;
    this.#drained = false;
    this.#ended = false;
    this.#held?.free();
    this.#held = first;
    this.#position = first ? Math.max(input.start, this.#seconds(first.pts, input)) : input.start;
    const transcoder = this.#transcoder;
    if (transcoder) {
      transcoder.decoder.close();
      transcoder.decoder = Decoder.createSync(input.stream);
      transcoder.filter.close();
      transcoder.filter = this.#createFilter(transcoder.decoder);
    }
  }

  #retire(input: Input): void {
    this.#join(input.close());
  }

  #running(): boolean {
    return (
      this.#input !== undefined && this.#credit > 0 && !this.#drained && !this.#ended && !this.#failed && !this.#closed
    );
  }

  #kick(): void {
    if (this.#pumping || !this.#running()) return;
    this.#pumping = this.#pump().finally(() => {
      this.#pumping = undefined;
      this.#flush();
      this.#kick();
    });
  }

  async #pump(): Promise<void> {
    try {
      while (this.#running()) {
        const input = this.#input as Input;
        let packet = this.#held;
        this.#held = undefined;
        if (!packet) {
          if (input.waiting()) this.#flush();
          const result = await input.read(this.#packet);
          if (input !== this.#input || this.#closed) {
            this.#packet.unref();
            continue;
          }
          if (result === AVERROR_EOF) {
            if (this.#seeking) this.#drained = true;
            else this.#finish();
            continue;
          }
          if (result < 0) {
            this.fail("read", input.failure ?? new FFmpegError(result), input.id);
            continue;
          }
          packet = this.#packet;
        }
        this.#process(packet, input);
      }
    } catch (error: unknown) {
      this.fail("decode", error);
    }
  }

  #process(packet: Packet, input: Input): void {
    try {
      if (packet.streamIndex !== input.stream.index) return;
      const data = packet.data;
      if (data && input.opus && this.#volume === 100 && this.#chain === undefined && twentyMsOpus(data)) {
        this.#toPassthrough();
        this.#position = Math.max(0, this.#seconds(packet.pts, input));
        this.#emit(data);
        return;
      }
      const transcoder = this.#transcoder ?? this.#createTranscoder();
      this.#transcoder = transcoder;
      this.#transcode(transcoder, transcoder.decoder.decodeAllSync(packet), input);
    } finally {
      if (packet === this.#packet) packet.unref();
      else packet.free();
    }
  }

  #transcode(transcoder: Transcoder, frames: Frame[], input: Input): void {
    for (const frame of frames) {
      try {
        const start = this.#frameSeconds(frame);
        if (start + frame.nbSamples / frame.sampleRate <= input.start) continue;
        this.#position = Math.max(0, start);
        this.#encode(transcoder, transcoder.filter.processAllSync(frame));
      } finally {
        frame.free();
      }
    }
  }

  #encode(transcoder: Transcoder, frames: Iterable<Frame>): void {
    const bitrate = this.#bitrate();
    if (bitrate !== transcoder.bitrate) {
      for (const packet of transcoder.encoder.flushPacketsSync()) this.#emitPacket(packet);
      transcoder.encoder.close();
      transcoder.encoder = this.#createEncoder(bitrate);
      transcoder.bitrate = bitrate;
    }
    for (const frame of frames) {
      try {
        for (const packet of transcoder.encoder.encodeAllSync(frame)) this.#emitPacket(packet);
      } finally {
        frame.free();
      }
    }
  }

  #emitPacket(packet: Packet): void {
    try {
      const data = packet.data;
      if (data) this.#emit(data);
    } finally {
      packet.free();
    }
  }

  #emit(data: Buffer): void {
    this.#batch.push(new Uint8Array(data).buffer);
    this.#batchPts.push(this.#position);
    this.#credit = Math.max(0, this.#credit - 1);
    if (this.#batch.length >= BATCH_PACKETS) this.#flush();
  }

  #flush(): void {
    if (this.#batch.length === 0) return;
    const packets = this.#batch;
    const pts = this.#batchPts;
    this.#batch = [];
    this.#batchPts = [];
    post({ type: "packets", track: this.id, packets, pts }, packets);
  }

  #toPassthrough(): void {
    const transcoder = this.#transcoder;
    if (!transcoder) return;
    for (const packet of transcoder.encoder.flushPacketsSync()) this.#emitPacket(packet);
    this.#dropTranscoder();
  }

  #finish(): void {
    const transcoder = this.#transcoder;
    if (transcoder) {
      this.#encode(transcoder, this.#decoded(transcoder));
      this.#encode(transcoder, transcoder.filter.flushFramesSync());
      for (const packet of transcoder.encoder.flushPacketsSync()) this.#emitPacket(packet);
      this.#dropTranscoder();
    }
    this.#drained = false;
    this.#ended = true;
    this.#flush();
    post({ type: "ended", track: this.id });
  }

  *#decoded(transcoder: Transcoder): Generator<Frame> {
    for (const frame of transcoder.decoder.flushFramesSync()) {
      try {
        yield* transcoder.filter.processAllSync(frame);
      } finally {
        frame.free();
      }
    }
  }

  #createTranscoder(): Transcoder {
    const decoder = Decoder.createSync((this.#input as Input).stream);
    let filter: FilterAPI | undefined;
    try {
      filter = this.#createFilter(decoder);
      const bitrate = this.#bitrate();
      return { decoder, filter, encoder: this.#createEncoder(bitrate), bitrate };
    } catch (error: unknown) {
      filter?.close();
      decoder.close();
      throw error;
    }
  }

  #bitrate(): number {
    return Math.min((this.#input as Input).bitRate ?? this.#target, this.#target);
  }

  #createEncoder(bitrate: number): Encoder {
    return Encoder.createSync(FF_ENCODER_LIBOPUS, {
      bitrate,
      options: { application: "audio", frame_duration: 20, compression_level: this.#complexity },
    });
  }

  #createFilter(decoder: Decoder): FilterAPI {
    return checkedFilter(() => graph(this.#chain, this.#volume), decoder.getCodecContext());
  }

  #dropTranscoder(): void {
    const transcoder = this.#transcoder;
    this.#transcoder = undefined;
    transcoder?.decoder.close();
    transcoder?.filter.close();
    transcoder?.encoder.close();
  }

  #seconds(pts: bigint, input: Input): number {
    const { num, den } = input.stream.timeBase;
    return pts === AV_NOPTS_VALUE || den === 0 ? this.#position : (Number(pts) * num) / den;
  }

  #endSeconds(packet: Packet, input: Input): number {
    const { num, den } = input.stream.timeBase;
    return this.#seconds(packet.pts, input) + (den === 0 ? 0 : (Number(packet.duration) * num) / den);
  }

  #frameSeconds(frame: Frame): number {
    const { num, den } = frame.timeBase;
    return frame.pts === AV_NOPTS_VALUE || den === 0 ? this.#position : (Number(frame.pts) * num) / den;
  }

  fail(stage: string, error: unknown, input?: number): void {
    if (this.#failed || this.#closed) return;
    this.#failed = true;
    this.#flush();
    post({ type: "failed", track: this.id, stage, ...(input === undefined ? {} : { input }), error: wire(error) });
  }
}

function probe(track: number, chain: string): void {
  try {
    checkedFilter(() => graph(chain, 100), null).close();
    post({ type: "settled", track, request: 0 });
  } catch (error: unknown) {
    post({ type: "settled", track, request: 0, error: wire(error) });
  }
}

function receive(message: ToWorker): void {
  try {
    dispatch(message);
  } catch (error: unknown) {
    if ("track" in message) pipelines.get(message.track)?.fail("worker", error);
  }
}

function dispatch(message: ToWorker): void {
  switch (message.type) {
    case "open": {
      const pipeline = new Pipeline(message.track, message.volume, message.chain, message.bitrate, message.complexity);
      pipelines.set(message.track, pipeline);
      void pipeline.open(message.input, message.source);
      return;
    }
    case "seek": {
      const pipeline = pipelines.get(message.track);
      pipeline
        ?.seek(message.request, message.input, message.source, message.seconds)
        .catch((error: unknown) => pipeline.fail("seek", error));
      return;
    }
    case "filters":
      pipelines.get(message.track)?.setFilters(message.request, message.chain);
      return;
    case "probe":
      probe(message.track, message.chain);
      return;
    case "volume":
      pipelines.get(message.track)?.setVolume(message.percent);
      return;
    case "bitrate":
      pipelines.get(message.track)?.setBitrate(message.bitrate);
      return;
    case "credit":
      pipelines.get(message.track)?.credit(message.count);
      return;
    case "close": {
      const pipeline = pipelines.get(message.track);
      if (pipeline) void pipeline.close();
      else post({ type: "closed", track: message.track });
      return;
    }
    case "bytes":
      remotes.get(message.input)?.receive(message);
      return;
    case "granted":
      grants.get(message.permit)?.();
      grants.delete(message.permit);
      return;
    case "exit":
      port?.close();
      return;
  }
}

if (port) {
  // libav's log level is process-wide, so this also silences any other libav user in the process.
  Log.setLevel(AV_LOG_QUIET);
  port.on("message", receive);
}
