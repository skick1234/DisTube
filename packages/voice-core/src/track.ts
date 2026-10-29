import { availableParallelism } from "node:os";
import { Readable } from "node:stream";
import { Worker } from "node:worker_threads";
import { DisTubeError } from "distube";
import type { FromWorker, PermitMessage, ToWorker, WireError } from "./protocol";
import {
  abortError,
  type ByteReply,
  type ByteServer,
  decodeFailure,
  fromWire,
  isSeekable,
  type LocalPlaybackResource,
  redactor,
  safeError,
  serveInput,
} from "./sources";

const HOLD_POLL_MS = 20;
const IDLE_EXIT_MS = 30_000;
const POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1));
// Unset, libuv starts 4 threads while Bun sizes its N-API pool to the CPUs.
const THREADPOOL_SIZE = Number(process.env.UV_THREADPOOL_SIZE) || (process.versions.bun ? availableParallelism() : 4);
const PERMITS = Math.max(1, THREADPOOL_SIZE - 1);
const ENTRY = new URL(`./worker.${import.meta.url.endsWith(".ts") ? "ts" : "mjs"}`, import.meta.url);

/** How a Track ended: its input reached the end, its owner closed it, or it failed with a redacted cause. */
export type TrackOutcome =
  | Readonly<{ type: "ended" }>
  | Readonly<{ type: "closed" }>
  | Readonly<{ type: "failed"; error: Error }>;

export interface TrackSettings {
  /** Percent, where 100 leaves the source untouched. */
  readonly volume: number;
  /** A libavfilter chain from the FilterRegistry, or `undefined` for none. */
  readonly chain: string | undefined;
  /** Bits per second a transcoded track encodes at, capped by its source's bitrate. */
  readonly bitrate: number;
  /** Opus encoder complexity, 0 to 10. */
  readonly opusComplexity: number;
  /** Packets of 20 ms queued ahead of the platform. */
  readonly readAhead: number;
}

type Settled = Extract<FromWorker, { type: "settled" }>;

let nextId = 0;

/**
 * One track's pipeline: Opus packets for Discord from any local playback resource.
 *
 * Demux, decode, filter and encode run in a pooled worker thread; this side moves input bytes in and
 * packets out. Source Opus at 48 kHz stereo in 20 ms packets passes through untouched while volume is 100
 * and no filter is set. Seek opens a second input and switches to it once it holds audio at the target, so
 * the old input plays until then.
 */
export class Track {
  /** Opus packets, one Buffer each, `readAhead` of them queued ahead. */
  readonly packets: Readable;
  /** Settles once: natural end after the platform played the last packet, close, or a failure. */
  readonly outcome: Promise<TrackOutcome>;
  readonly #id = ++nextId;
  readonly #readAhead: number;
  readonly #resource: LocalPlaybackResource;
  readonly #redact: (value: string) => string;
  readonly #lease: Lease;
  readonly #servers = new Map<number, ByteServer>();
  readonly #retiredFailures = new Map<number, Error>();
  readonly #requests = new Map<number, (settled: Settled) => void>();
  readonly #pts: number[] = [];
  #ptsStart = 0;
  #emitted = 0;
  #granted = 0;
  #floor?: { readonly emitted: number; readonly seconds: number };
  #counter?: () => number;
  #opened!: { resolve(): void; reject(error: Error): void };
  #closed!: () => void;
  readonly #closedSignal: Promise<void>;
  #seeks = 0;
  #seekController?: AbortController;
  #inputEnded = false;
  #hold?: NodeJS.Timeout;
  #settle!: (outcome: TrackOutcome) => void;
  #settled = false;
  #closing?: Promise<void>;

  private constructor(resource: LocalPlaybackResource, redact: (value: string) => string, readAhead: number) {
    this.#readAhead = readAhead;
    this.#resource = resource;
    this.#redact = redact;
    this.outcome = new Promise(resolve => {
      this.#settle = resolve;
    });
    this.#closedSignal = new Promise(resolve => {
      this.#closed = resolve;
    });
    this.packets = new Readable({ objectMode: true, highWaterMark: readAhead, read: () => this.#grant() });
    this.#lease = attach(this.#id, this.#receive);
  }

  /** Opens `resource` from its start; a resource libav cannot open or decode rejects here, before any audio. */
  static async open(resource: LocalPlaybackResource, settings: TrackSettings, signal: AbortSignal): Promise<Track> {
    const redact = redactor(resource);
    signal.throwIfAborted();
    const input = ++nextId;
    let track: Track | undefined;
    let server: ByteServer;
    try {
      server = await serveInput(resource, 0, signal, redact, message => {
        if (track) track.#reply(input, message);
      });
    } catch (error: unknown) {
      throw error instanceof DisTubeError || isAbort(error) ? error : decodeFailure("open", error, redact);
    }
    if (signal.aborted) {
      server.close();
      throw abortError();
    }
    track = new Track(resource, redact, settings.readAhead);
    track.#servers.set(input, server);
    const opened = new Promise<void>((resolve, reject) => {
      if (track) track.#opened = { resolve, reject };
    });
    void opened.catch(() => undefined);
    const abort = (): void => {
      if (track) track.#opened.reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      track.#lease.post({
        type: "open",
        track: track.#id,
        input,
        source: server.source,
        volume: settings.volume,
        chain: settings.chain,
        bitrate: settings.bitrate,
        complexity: settings.opusComplexity,
      });
      await opened;
      return track;
    } catch (error: unknown) {
      await track.close();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  /** Source seconds of the last packet the platform played, so tempo filters and platform queues do not skew it. */
  get position(): number {
    const played = this.#played();
    this.#forget(played);
    const floor = this.#floor;
    if (floor && played <= floor.emitted) return floor.seconds;
    this.#floor = undefined;
    return played === 0 ? 0 : (this.#pts[played - 1 - this.#ptsStart] ?? 0);
  }

  /** Whether the outcome has settled: ended, closed or failed. */
  get settled(): boolean {
    return this.#settled;
  }

  setPlayedCounter(counter: () => number): void {
    this.#counter = counter;
  }

  setVolume(percent: number): void {
    if (!this.#closing && !this.#settled) this.#lease.post({ type: "volume", track: this.#id, percent });
  }

  /** Rebuilds the encoder at the next transcoded frame; passthrough keeps the source's own bitrate. */
  setBitrate(bitrate: number): void {
    if (!this.#closing && !this.#settled) this.#lease.post({ type: "bitrate", track: this.#id, bitrate });
  }

  /** Applies from the next decoded frame; a chain libavfilter cannot build rejects `INVALID_ARGUMENT`. */
  async setFilters(chain: string | undefined): Promise<void> {
    if (this.#closing || this.#settled) return;
    const settled = await this.#call(request => ({ type: "filters", track: this.#id, request, chain }));
    if (settled.superseded) throw new DisTubeError("INVALID_STATE", "Track ended before the filter chain was applied");
    if (settled.error) throw filterRejection(settled.error, this.#redact);
  }

  /** Resolves once the new input holds audio at `seconds` and playback switched to it. */
  async seek(seconds: number): Promise<void> {
    if (!isSeekable(this.#resource)) throw new DisTubeError("UNSUPPORTED", "This playback resource is not seekable");
    if (this.#closing || this.#settled) throw new DisTubeError("INVALID_STATE", "Track has no running input");
    this.#seekController?.abort();
    const controller = new AbortController();
    this.#seekController = controller;
    this.#seeks += 1;
    try {
      let input: number;
      try {
        input = await this.#serve(seconds, controller.signal);
      } catch (error: unknown) {
        if (controller.signal.aborted) throw superseded(controller.signal);
        throw decodeFailure("seek", error, this.#redact);
      }
      const source = (this.#servers.get(input) as ByteServer).source;
      const settled = await this.#call(request => ({ type: "seek", track: this.#id, request, input, source, seconds }));
      if (settled.superseded)
        throw controller.signal.aborted
          ? superseded(controller.signal)
          : new DisTubeError("INVALID_STATE", "Track ended before the seek was applied");
      if (settled.error) throw this.#failure("seek", settled.error, settled.input);
      this.#inputEnded = false;
      this.#floor = { emitted: this.#emitted, seconds: settled.position ?? seconds };
    } finally {
      this.#seeks -= 1;
      if (this.#seekController === controller) this.#seekController = undefined;
      this.#checkEnd();
    }
  }

  /** Ends the pipeline once and joins every input it opened, including one a pending seek is opening. */
  close(): Promise<void> {
    this.#closing ??= this.#teardown();
    return this.#closing;
  }

  async #teardown(): Promise<void> {
    this.#resolve({ type: "closed" });
    this.#seekController?.abort();
    this.#stopHold();
    this.packets.destroy();
    this.#lease.post({ type: "close", track: this.#id });
    await this.#closedSignal;
    for (const server of this.#servers.values()) server.close();
    this.#lease.detach();
  }

  #reply(input: number, message: ByteReply): void {
    this.#lease.post({ type: "bytes", input, ...message }, message.chunk ? [message.chunk] : []);
  }

  async #serve(seconds: number, signal: AbortSignal): Promise<number> {
    const input = ++nextId;
    const server = await serveInput(this.#resource, seconds, signal, this.#redact, message =>
      this.#reply(input, message),
    );
    if (this.#closing) {
      server.close();
      throw abortError();
    }
    this.#servers.set(input, server);
    return input;
  }

  #call(message: (request: number) => Parameters<Lease["post"]>[0]): Promise<Settled> {
    const request = ++nextId;
    return new Promise(resolve => {
      this.#requests.set(request, resolve);
      this.#lease.post(message(request));
    });
  }

  /** Keeps queued plus requested packets at `readAhead`; Readable reads again only after a push, so a full queue still asks for the one it hands out. */
  #grant(): void {
    if (this.#settled) return;
    const want = Math.max(this.#readAhead - this.#granted - this.packets.readableLength, this.#granted === 0 ? 1 : 0);
    if (want <= 0) return;
    this.#granted += want;
    this.#lease.post({ type: "credit", track: this.#id, count: want });
  }

  readonly #receive = (message: FromWorker): void => {
    switch (message.type) {
      case "opened":
        this.#opened.resolve();
        return;
      case "packets":
        this.#granted = Math.max(0, this.#granted - message.packets.length);
        for (const [index, packet] of message.packets.entries()) {
          if (this.#settled) return;
          this.#pts.push(message.pts[index] ?? 0);
          this.#emitted += 1;
          this.packets.push(Buffer.from(packet));
        }
        this.#forget(this.#played());
        return;
      case "settled":
        this.#requests.get(message.request)?.(message);
        this.#requests.delete(message.request);
        return;
      case "ended":
        this.#inputEnded = true;
        this.#checkEnd();
        return;
      case "failed": {
        const error = this.#failure(message.stage, message.error, message.input);
        this.#opened.reject(error);
        this.#fail(error);
        return;
      }
      case "read":
        this.#servers.get(message.input)?.read(message.request, message);
        return;
      case "cancel":
        this.#servers.get(message.input)?.cancel(message.request);
        return;
      case "retired": {
        const server = this.#servers.get(message.input);
        this.#servers.delete(message.input);
        server?.close();
        if (server?.failure) this.#retiredFailures.set(message.input, server.failure);
        return;
      }
      case "closed":
        for (const resolve of this.#requests.values())
          resolve({ type: "settled", track: this.#id, request: 0, superseded: true });
        this.#requests.clear();
        this.#closed();
        return;
    }
  };

  #failure(stage: string, error: WireError, input: number | undefined): Error {
    const local =
      input === undefined ? undefined : (this.#retiredFailures.get(input) ?? this.#servers.get(input)?.failure);
    if (input !== undefined) this.#retiredFailures.delete(input);
    if (!local && (error.code === "INVALID_ARGUMENT" || error.code === "SOURCE_FAILED")) {
      return new DisTubeError(error.code, error.message, {
        cause: error.cause ? safeError(fromWire(error.cause), this.#redact) : undefined,
      });
    }
    return decodeFailure(stage, local ?? fromWire(error), this.#redact);
  }

  #played(): number {
    const played = this.#counter ? Math.floor(this.#counter()) : this.#emitted - this.packets.readableLength;
    return Number.isFinite(played) ? Math.min(Math.max(played, 0), this.#emitted) : 0;
  }

  #forget(played: number): void {
    const stale = played - 1 - this.#ptsStart;
    if (stale <= 0) return;
    this.#pts.splice(0, stale);
    this.#ptsStart += stale;
  }

  #checkEnd(): void {
    if (!this.#inputEnded || this.#settled || this.#closing || this.#seeks > 0) {
      this.#stopHold();
      return;
    }
    if (this.#played() < this.#emitted) {
      this.#hold ??= setInterval(() => this.#checkEnd(), HOLD_POLL_MS).unref();
      return;
    }
    this.#stopHold();
    this.packets.push(null);
    this.#resolve({ type: "ended" });
  }

  #stopHold(): void {
    clearInterval(this.#hold);
    this.#hold = undefined;
  }

  #fail(error: Error): void {
    if (this.#settled || this.#closing) return;
    this.#stopHold();
    this.packets.destroy();
    this.#resolve({ type: "failed", error });
  }

  #resolve(outcome: TrackOutcome): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#settle(outcome);
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function superseded(signal: AbortSignal): DisTubeError {
  return new DisTubeError("ABORTED", "Seek was superseded", { cause: signal.reason });
}

export async function probeFilters(chain: string): Promise<void> {
  const track = ++nextId;
  const { promise, resolve } = Promise.withResolvers<Extract<FromWorker, { type: "settled" | "failed" }>>();
  const lease = attach(track, message => {
    if (message.type === "settled" || message.type === "failed") resolve(message);
  });
  try {
    lease.post({ type: "probe", track, chain });
    const settled = await promise;
    if (settled.type === "failed") throw fromWire(settled.error);
    if (settled.error) throw filterRejection(settled.error, value => value);
  } finally {
    lease.detach();
  }
}

function filterRejection(error: WireError, redact: (value: string) => string): DisTubeError {
  return new DisTubeError("INVALID_ARGUMENT", "Filter chain could not be applied", {
    cause: safeError(fromWire(error.cause ?? error), redact),
  });
}

type Listener = (message: FromWorker) => void;

interface Thread {
  readonly worker: Worker;
  readonly tracks: Map<number, Listener>;
  readonly permits: Set<number>;
  idle?: NodeJS.Timeout;
}

interface Lease {
  post(message: ToWorker, transfer?: readonly ArrayBuffer[]): void;
  detach(): void;
}

const threads: Thread[] = [];
let queued: { readonly thread: Thread; readonly permit: number }[] = [];
let available = PERMITS;

function attach(track: number, listener: Listener): Lease {
  const thread = pick();
  clearTimeout(thread.idle);
  thread.idle = undefined;
  thread.tracks.set(track, listener);
  thread.worker.ref();
  return {
    post: (message, transfer = []) => thread.worker.postMessage(message, transfer),
    detach: () => {
      if (!thread.tracks.delete(track) || thread.tracks.size > 0 || !threads.includes(thread)) return;
      thread.worker.unref();
      thread.idle = setTimeout(() => retire(thread), IDLE_EXIT_MS).unref();
    },
  };
}

function pick(): Thread {
  let least: Thread | undefined;
  for (const thread of threads) if (!least || thread.tracks.size < least.tracks.size) least = thread;
  if (least && (least.tracks.size === 0 || threads.length >= POOL_SIZE)) return least;
  return spawn();
}

function spawn(): Thread {
  const worker = new Worker(ENTRY);
  const thread: Thread = { worker, tracks: new Map(), permits: new Set() };
  worker.on("message", (message: FromWorker | PermitMessage) => {
    if (message.type === "acquire") acquire(thread, message.permit);
    else if (message.type === "release") release(thread, message.permit);
    else thread.tracks.get(message.track)?.(message);
  });
  worker.on("error", (error: Error) => lose(thread, error.message));
  worker.on("exit", () => lose(thread, "Playback worker exited"));
  threads.push(thread);
  return thread;
}

// node-av documents that Worker.terminate() during a native call can abort the process, so an idle worker exits itself.
function retire(thread: Thread): void {
  if (thread.tracks.size > 0) return;
  threads.splice(threads.indexOf(thread), 1);
  thread.worker.postMessage({ type: "exit" } satisfies ToWorker, []);
}

// Native open and pre-read seek park a libuv pool thread until main delivers bytes, maybe via dns.lookup on that pool.
function acquire(thread: Thread, permit: number): void {
  if (available === 0) {
    queued.push({ thread, permit });
    return;
  }
  available -= 1;
  thread.permits.add(permit);
  thread.worker.postMessage({ type: "granted", permit } satisfies ToWorker, []);
}

function release(thread: Thread, permit: number): void {
  if (thread.permits.delete(permit)) {
    available += 1;
    grantQueued();
    return;
  }
  queued = queued.filter(entry => entry.thread !== thread || entry.permit !== permit);
}

function grantQueued(): void {
  while (available > 0) {
    const next = queued.shift();
    if (!next) return;
    acquire(next.thread, next.permit);
  }
}

function lose(thread: Thread, message: string): void {
  const index = threads.indexOf(thread);
  if (index >= 0) threads.splice(index, 1);
  clearTimeout(thread.idle);
  queued = queued.filter(entry => entry.thread !== thread);
  available += thread.permits.size;
  thread.permits.clear();
  grantQueued();
  const tracks = [...thread.tracks];
  thread.tracks.clear();
  for (const [track, listener] of tracks) {
    listener({ type: "failed", track, stage: "worker", error: { name: "Error", message } });
    listener({ type: "closed", track });
  }
}
