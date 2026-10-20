import { readSync } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import {
  AV_CH_LAYOUT_STEREO,
  AV_CHANNEL_ORDER_NATIVE,
  AV_CODEC_ID_OPUS,
  AV_LOG_QUIET,
  AV_NOPTS_VALUE,
  AV_SAMPLE_FMT_S16,
  AVERROR_EINVAL,
  AVERROR_EIO,
  AVERROR_EOF,
  AVERROR_EXIT,
  AVERROR_INVALIDDATA,
  AVSEEK_FLAG_BACKWARD,
  AVSEEK_SIZE,
  Decoder,
  Demuxer,
  Encoder,
  FF_ENCODER_LIBOPUS,
  FFmpegError,
  FilterAPI,
  Frame,
  type IOInputCallbacks,
  Log,
  Packet,
  type Stream,
} from "node-av";

export type Container = "webm" | "mp4";

export type InputSource =
  | Readonly<{ kind: "file"; path: string }>
  | Readonly<{ kind: "ranged"; size: number; container?: Container }>
  | Readonly<{ kind: "oneshot"; container?: Container }>;

export interface WireError {
  readonly name: string;
  readonly message: string;
  readonly code?: string | number;
  readonly cause?: WireError;
  readonly errors?: readonly WireError[];
}

export type ToWorker =
  | Readonly<{
      type: "open";
      track: number;
      input: number;
      source: InputSource;
      volume: number;
      chain: string | undefined;
    }>
  | Readonly<{ type: "seek"; track: number; request: number; input: number; source: InputSource; seconds: number }>
  | Readonly<{ type: "filters"; track: number; request: number; chain: string | undefined }>
  | Readonly<{ type: "volume"; track: number; percent: number }>
  | Readonly<{ type: "credit"; track: number; count: number }>
  | Readonly<{ type: "close"; track: number }>
  | Readonly<{
      type: "bytes";
      input: number;
      request: number;
      chunk?: ArrayBuffer;
      done?: boolean;
      failed?: boolean;
    }>
  | Readonly<{ type: "granted"; permit: number }>
  | Readonly<{ type: "exit" }>;

export type PermitMessage =
  | Readonly<{ type: "acquire"; permit: number }>
  | Readonly<{ type: "release"; permit: number }>;

export interface WorkerLimits {
  readonly windowBytes: number;
  readonly errorDepth: number;
  readonly errorNodes: number;
  readonly errorText: number;
}

export type FromWorker =
  | Readonly<{ type: "opened"; track: number }>
  | Readonly<{ type: "packets"; track: number; packets: ArrayBuffer[]; pts: number[] }>
  | Readonly<{
      type: "settled";
      track: number;
      request: number;
      position?: number;
      superseded?: boolean;
      input?: number;
      error?: WireError;
    }>
  | Readonly<{ type: "ended"; track: number }>
  | Readonly<{ type: "failed"; track: number; stage: string; input?: number; error: WireError }>
  | Readonly<{ type: "closed"; track: number }>
  | Readonly<{
      type: "read";
      track: number;
      input: number;
      request: number;
      start?: number;
      end?: number;
      want?: number;
    }>
  | Readonly<{ type: "cancel"; track: number; input: number; request: number }>
  | Readonly<{ type: "retired"; track: number; input: number }>;

const OUTPUT_FORMAT = "aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo";
const VOLUME_FILTER = "volume@distube";
const FILE_PROBE_BYTES = 256 * 1024;
const REMOTE_PROBE_BYTES = 4 * 1024;
const IO_BUFFER_BYTES = 16 * 1024;
const DEFAULT_BITRATE = 128_000;
const BATCH_PACKETS = 5;

const port = parentPort;
const limits: WorkerLimits = workerData;
const pipelines = new Map<number, Pipeline>();
const remotes = new Map<number, RemoteSource>();
const grants = new Map<number, () => void>();
let nextPermit = 0;

function post(message: FromWorker | PermitMessage, transfer: ArrayBuffer[] = []): void {
  port?.postMessage(message, transfer);
}

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

function wire(value: unknown, depth = 0, budget = { nodes: 0 }): WireError {
  if (!(value instanceof Error)) return { name: "Error", message: "Non-error cause" };
  if (depth >= limits.errorDepth || budget.nodes >= limits.errorNodes) {
    return { name: "Error", message: "Error cause truncated" };
  }
  budget.nodes += 1;
  try {
    const own = Object.getOwnPropertyDescriptor(value, "code");
    const code = value instanceof FFmpegError ? value.code : own && "value" in own ? own.value : undefined;
    const cause = Object.getOwnPropertyDescriptor(value, "cause");
    return {
      name: String(value.name).slice(0, limits.errorText),
      message: String(value.message).slice(0, limits.errorText),
      ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
      ...(cause && "value" in cause ? { cause: wire(cause.value, depth + 1, budget) } : {}),
      ...(value instanceof AggregateError
        ? { errors: Array.from(value.errors as unknown[], error => wire(error, depth + 1, budget)) }
        : {}),
    };
  } catch {
    return { name: "Error", message: "Uninspectable error cause" };
  }
}

interface ByteSource {
  readonly callbacks: IOInputCallbacks;
  readonly failure: Error | undefined;
  probe(): Promise<Buffer>;
  waiting(): boolean;
  close(): void | Promise<void>;
}

function seekTarget(offset: bigint, whence: number, position: number, size: number): number | undefined {
  const base = whence & 3;
  const target = base === 0 ? Number(offset) : base === 1 ? position + Number(offset) : size + Number(offset);
  return Number.isSafeInteger(target) && target >= 0 ? target : undefined;
}

class FileSource implements ByteSource {
  failure: Error | undefined;
  readonly callbacks: IOInputCallbacks;
  readonly #handle: FileHandle;
  readonly #size: number;
  #position = 0;
  #closing?: Promise<void>;

  private constructor(handle: FileHandle, size: number) {
    this.#handle = handle;
    this.#size = size;
    this.callbacks = { read: bytes => this.#read(bytes), seek: (offset, whence) => this.#seek(offset, whence) };
  }

  static async open(path: string): Promise<FileSource> {
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, "r");
      const { size } = await handle.stat();
      return new FileSource(handle, size);
    } catch (error: unknown) {
      await handle?.close().catch(() => undefined);
      throw new Error(`Playback file could not be opened: ${error instanceof Error ? error.message : ""}`, {
        cause: error,
      });
    }
  }

  async probe(): Promise<Buffer> {
    const bytes = Buffer.alloc(Math.min(this.#size, FILE_PROBE_BYTES));
    const { bytesRead } = await this.#handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  }

  waiting(): boolean {
    return false;
  }

  close(): Promise<void> {
    this.#closing ??= this.#handle.close().catch(() => undefined);
    return this.#closing;
  }

  #read(size: number): Buffer | number {
    if (this.#closing) return AVERROR_EXIT;
    try {
      const bytes = Buffer.allocUnsafe(size);
      const read = readSync(this.#handle.fd, bytes, 0, size, this.#position);
      if (read === 0) return AVERROR_EOF;
      this.#position += read;
      return bytes.subarray(0, read);
    } catch (error: unknown) {
      this.failure = new Error("Playback file could not be read", { cause: error });
      return AVERROR_EIO;
    }
  }

  #seek(offset: bigint, whence: number): bigint | number {
    if (whence & AVSEEK_SIZE) return BigInt(this.#size);
    const target = seekTarget(offset, whence, this.#position, this.#size);
    if (target === undefined) return AVERROR_EINVAL;
    this.#position = target;
    return BigInt(target);
  }
}

class Chunks {
  #chunks: Buffer[] = [];
  length = 0;

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    this.#chunks.push(chunk);
    this.length += chunk.length;
  }

  take(size: number): Buffer {
    const parts: Buffer[] = [];
    let remaining = Math.min(size, this.length);
    while (remaining > 0) {
      const head = this.#chunks[0] as Buffer;
      if (head.length <= remaining) {
        parts.push(head);
        this.#chunks.shift();
        remaining -= head.length;
      } else {
        parts.push(head.subarray(0, remaining));
        this.#chunks[0] = head.subarray(remaining);
        remaining = 0;
      }
    }
    const taken = parts.length === 1 ? (parts[0] as Buffer) : Buffer.concat(parts);
    this.length -= taken.length;
    return taken;
  }

  peek(): Buffer {
    return Buffer.concat(this.#chunks);
  }

  clear(): void {
    this.#chunks = [];
    this.length = 0;
  }
}

abstract class RemoteSource implements ByteSource {
  failure: Error | undefined;
  readonly track: number;
  readonly input: number;
  protected readonly buffer = new Chunks();
  protected ended = false;
  protected closed = false;
  #waiters: (() => void)[] = [];

  constructor(track: number, input: number) {
    this.track = track;
    this.input = input;
    remotes.set(input, this);
  }

  abstract readonly callbacks: IOInputCallbacks;

  async probe(): Promise<Buffer> {
    await this.until(() => this.buffer.length >= REMOTE_PROBE_BYTES || this.ended);
    return this.buffer.peek();
  }

  waiting(): boolean {
    return this.buffer.length === 0 && !this.ended && !this.failure && !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    remotes.delete(this.input);
    this.buffer.clear();
    this.release();
    this.wake();
  }

  abstract receive(message: Extract<ToWorker, { type: "bytes" }>): void;

  protected abstract release(): void;

  protected abstract consumed(bytes: number): void;

  protected request(fields: { request: number; start?: number; end?: number; want?: number }): void {
    post({ type: "read", track: this.track, input: this.input, ...fields });
  }

  protected fail(error: Error): void {
    if (this.failure || this.closed) return;
    this.failure = error;
    this.release();
    this.wake();
  }

  protected wake(): void {
    for (const waiter of this.#waiters.splice(0)) waiter();
  }

  protected async until(settled: () => boolean): Promise<void> {
    while (!settled() && !this.failure && !this.closed) await new Promise<void>(resolve => this.#waiters.push(resolve));
  }

  protected readBytes(size: number): Buffer | number | Promise<Buffer | number> {
    if (this.closed) return AVERROR_EXIT;
    if (this.buffer.length > 0) {
      const chunk = this.buffer.take(size);
      this.consumed(chunk.length);
      return chunk;
    }
    if (this.failure) return AVERROR_EIO;
    if (this.ended) return AVERROR_EOF;
    return new Promise<void>(resolve => this.#waiters.push(resolve)).then(() => this.readBytes(size));
  }
}

let nextRequest = 0;

class OneShotSource extends RemoteSource {
  readonly callbacks: IOInputCallbacks;
  #requested?: number;

  constructor(track: number, input: number) {
    super(track, input);
    this.callbacks = { read: size => this.readBytes(size) };
    this.#pull();
  }

  receive(message: Extract<ToWorker, { type: "bytes" }>): void {
    if (message.request !== this.#requested) return;
    this.#requested = undefined;
    if (message.failed) this.fail(new Error("Playback input failed"));
    else if (message.done) this.ended = true;
    else if (message.chunk) this.buffer.push(Buffer.from(message.chunk));
    this.wake();
    this.#pull();
  }

  protected consumed(): void {
    this.#pull();
  }

  protected release(): void {
    this.#requested = undefined;
  }

  #pull(): void {
    if (this.#requested !== undefined || this.ended || this.failure || this.closed) return;
    const want = limits.windowBytes - this.buffer.length;
    if (want < limits.windowBytes / 2) return;
    this.#requested = ++nextRequest;
    this.request({ request: this.#requested, want });
  }
}

class RangedSource extends RemoteSource {
  readonly callbacks: IOInputCallbacks;
  readonly #size: number;
  #position = 0;
  #fetched = 0;
  #window?: { request: number; end: number };

  constructor(track: number, input: number, size: number) {
    super(track, input);
    this.#size = size;
    this.callbacks = {
      read: bytes => this.readBytes(bytes),
      seek: (offset, whence) => this.#seek(offset, whence),
    };
    this.#fill();
  }

  receive(message: Extract<ToWorker, { type: "bytes" }>): void {
    const window = this.#window;
    if (!window || message.request !== window.request) return;
    if (message.failed) {
      this.#window = undefined;
      this.fail(new Error("Playback input failed"));
      return;
    }
    if (message.chunk) {
      this.buffer.push(Buffer.from(message.chunk));
      this.wake();
    }
    if (!message.done) return;
    this.#window = undefined;
    this.#fetched = window.end + 1;
    this.wake();
    this.#fill();
  }

  async settled(): Promise<void> {
    const window = this.#window;
    if (window) await this.until(() => this.#window !== window);
  }

  protected consumed(bytes: number): void {
    this.#position += bytes;
    this.#fill();
  }

  protected release(): void {
    const window = this.#window;
    this.#window = undefined;
    if (window) post({ type: "cancel", track: this.track, input: this.input, request: window.request });
  }

  #seek(offset: bigint, whence: number): bigint | number {
    if (whence & AVSEEK_SIZE) return BigInt(this.#size);
    const target = seekTarget(offset, whence, this.#position, this.#size);
    if (target === undefined) return AVERROR_EINVAL;
    if (target >= this.#position && target <= this.#position + this.buffer.length) {
      this.buffer.take(target - this.#position);
    } else {
      this.release();
      this.buffer.clear();
      this.#fetched = target;
      this.ended = false;
    }
    this.#position = target;
    this.#fill();
    return BigInt(target);
  }

  #fill(): void {
    if (this.#window || this.closed || this.failure) return;
    if (this.#fetched >= this.#size) {
      this.ended = true;
      this.wake();
      return;
    }
    const room = limits.windowBytes - this.buffer.length;
    if (room < limits.windowBytes / 2) return;
    const start = this.#fetched;
    const end = Math.min(this.#size, start + room) - 1;
    this.#window = { request: ++nextRequest, end };
    this.request({ request: this.#window.request, start, end });
  }
}

class Input {
  readonly id: number;
  readonly stream: Stream;
  readonly opus: boolean;
  readonly bitRate: number;
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
    this.bitRate = known === undefined ? DEFAULT_BITRATE : Math.min(Math.max(Number(known), 6_000), 510_000);
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
    signal.throwIfAborted();
    const container = source.kind === "file" ? undefined : source.container;
    const format = container ? (container === "mp4" ? "mp4" : "matroska") : probedFormat(await bytes.probe(), bytes);
    demuxer = await withPermit(signal, async () => {
      const opened = await Demuxer.open(bytes.callbacks, { format, bufferSize: IO_BUFFER_BYTES, signal });
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

interface Transcoder {
  decoder: Decoder;
  filter: FilterAPI;
  readonly encoder: Encoder;
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

  constructor(id: number, volume: number, chain: string | undefined) {
    this.id = id;
    this.#volume = volume;
    this.#chain = chain;
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
      if (this.#chain !== undefined) this.#assertRenders(this.#chain);
      if (!opened.opus) this.#transcoder = this.#createTranscoder();
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
    try {
      if (chain !== undefined) this.#assertRenders(chain);
    } catch (error: unknown) {
      post({ type: "settled", track: this.id, request, error: wire(error) });
      return;
    }
    this.#chain = chain;
    const transcoder = this.#transcoder;
    if (transcoder) {
      transcoder.filter.close();
      transcoder.filter = this.#createFilter();
    }
    post({ type: "settled", track: this.id, request });
    this.#kick();
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
      transcoder.filter = this.#createFilter();
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

  #encode({ encoder }: Transcoder, frames: Iterable<Frame>): void {
    for (const frame of frames) {
      try {
        for (const packet of encoder.encodeAllSync(frame)) this.#emitPacket(packet);
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
    const input = this.#input as Input;
    const decoder = Decoder.createSync(input.stream);
    const filter = this.#createFilter();
    const encoder = Encoder.createSync(FF_ENCODER_LIBOPUS, {
      bitrate: input.bitRate,
      options: { application: "audio", frame_duration: 20, compression_level: 10 },
    });
    return { decoder, filter, encoder };
  }

  #createFilter(): FilterAPI {
    return FilterAPI.create(() => graph(this.#chain, this.#volume));
  }

  #dropTranscoder(): void {
    const transcoder = this.#transcoder;
    this.#transcoder = undefined;
    transcoder?.decoder.close();
    transcoder?.filter.close();
    transcoder?.encoder.close();
  }

  #assertRenders(chain: string): void {
    const silence = Frame.fromAudioBuffer(Buffer.alloc(960 * 4), {
      nbSamples: 960,
      format: AV_SAMPLE_FMT_S16,
      sampleRate: 48_000,
      channelLayout: { nbChannels: 2, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_STEREO },
      timeBase: { num: 1, den: 48_000 },
      pts: 0n,
    });
    const filter = FilterAPI.create(graph(chain, this.#volume));
    try {
      for (const frame of filter.processAllSync(silence)) frame.free();
    } catch (error: unknown) {
      throw Object.assign(new Error("Filter chain could not be applied", { cause: error }), {
        code: "INVALID_ARGUMENT",
      });
    } finally {
      filter.close();
      silence.free();
    }
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
      const pipeline = new Pipeline(message.track, message.volume, message.chain);
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
    case "volume":
      pipelines.get(message.track)?.setVolume(message.percent);
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
