import { availableParallelism } from "node:os";
import type { EventLoopUtilization } from "node:perf_hooks";
import { Readable } from "node:stream";
import { Worker } from "node:worker_threads";
import { DisTubeError } from "distube";
import type { Diagnostic, DiagnosticSeverity } from "distube/integrations";
import type { FromWorker, PermitMessage, ToWorker, WireError } from "./protocol";
import {
  abortError,
  type ByteReply,
  type ByteServer,
  decodeFailure,
  fromWire,
  type LocalPlaybackResource,
  redactor,
  safeError,
  serveInput,
} from "./sources";

const HOLD_POLL_MS = 20;
const MAX_REOPENS = 3;
const IDLE_EXIT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000;
const STARVED_REPORT_MS = 100;
const LOAD_INTERVAL_MS = 30_000;
const POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1));
// Unset, libuv starts 4 threads while Bun sizes its N-API pool to the CPUs.
const THREADPOOL_SIZE = Number(process.env.UV_THREADPOOL_SIZE) || (process.versions.bun ? availableParallelism() : 4);
const PERMITS = Math.max(1, THREADPOOL_SIZE - 1);
const ENTRY = new URL(`./worker.${import.meta.url.endsWith(".ts") ? "ts" : "mjs"}`, import.meta.url);

/** How a Track ended: its input reached the end, its owner closed it, or it failed at a pipeline step with a redacted cause. */
export type TrackOutcome =
  | Readonly<{ type: "ended" }>
  | Readonly<{ type: "closed" }>
  | Readonly<{ type: "failed"; step: string; error: Error }>;

type Report = (diagnostic: Diagnostic) => void;

const failedSteps = new WeakMap<Error, string>();

export function openFailureStep(error: unknown): string {
  return (error instanceof Error && failedSteps.get(error)) || "open";
}

export interface TrackReporter {
  readonly guildId: string;
  readonly report: Report;
}

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
type Lost = Extract<FromWorker, { type: "lost" }>;

let nextId = 0;

/**
 * One track's pipeline: Opus packets for Discord from any local playback resource.
 *
 * Demux, decode, filter and encode run in a pooled worker thread; this side moves input bytes in and
 * packets out. Source Opus at 48 kHz stereo in 20 ms packets passes through untouched while volume is 100
 * and no filter is set. Seek opens a second input and switches to it once it holds audio at the target, so
 * the old input plays until then. A seekable input that fails mid-track reopens the same way where its last
 * packet ended, at most `MAX_REOPENS` times in a row without a new packet.
 */
export class Track {
  /** Opus packets, one Buffer each, `readAhead` of them queued ahead. */
  readonly packets: Readable;
  /** Settles once: natural end after the platform played the last packet, close, or a failure. */
  readonly outcome: Promise<TrackOutcome>;
  readonly #id = ++nextId;
  readonly #readAhead: number;
  readonly #resource: LocalPlaybackResource;
  readonly #seekable: boolean;
  readonly #redact: (value: string) => string;
  readonly #reporter: TrackReporter;
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
  #lost?: Lost;
  #reopens = 0;
  #reopenedAt = 0;
  #retries = 0;
  #starvedSince?: number;
  #inputEnded = false;
  #hold?: NodeJS.Timeout;
  #settle!: (outcome: TrackOutcome) => void;
  #settled = false;
  #closing?: Promise<void>;

  private constructor(
    resource: LocalPlaybackResource,
    first: ByteServer,
    redact: (value: string) => string,
    readAhead: number,
    reporter: TrackReporter,
  ) {
    this.#readAhead = readAhead;
    this.#resource = resource;
    this.#seekable = resource.kind === "url" ? first.source.kind === "ranged" : resource.kind !== "stream";
    this.#redact = redact;
    this.#reporter = reporter;
    this.outcome = new Promise(resolve => {
      this.#settle = resolve;
    });
    this.#closedSignal = new Promise(resolve => {
      this.#closed = resolve;
    });
    this.packets = new Packets(
      readAhead,
      () => this.#grant(),
      () => this.#starve(),
    );
    this.#lease = attach(this.#id, this.#receive, reporter.report);
  }

  /** Opens `resource` from its start; a resource libav cannot open or decode rejects here, before any audio. */
  static async open(
    resource: LocalPlaybackResource,
    settings: TrackSettings,
    signal: AbortSignal,
    reporter: TrackReporter,
  ): Promise<Track> {
    const redact = redactor(resource);
    signal.throwIfAborted();
    const input = ++nextId;
    let track: Track | undefined;
    let server: ByteServer;
    try {
      server = await serveInput(
        resource,
        0,
        signal,
        redact,
        message => {
          if (track) track.#reply(input, message);
        },
        offset => {
          if (track) track.#retried(offset);
        },
      );
    } catch (error: unknown) {
      throw error instanceof DisTubeError || isAbort(error) ? error : decodeFailure("open", error, redact);
    }
    if (signal.aborted) {
      server.close();
      throw abortError();
    }
    track = new Track(resource, server, redact, settings.readAhead, reporter);
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

  /** Resolves once playback switched to a new input holding audio at `seconds`; the old input's queued packets are dropped. */
  async seek(seconds: number): Promise<void> {
    if (!this.#seekable) throw new DisTubeError("UNSUPPORTED", "This playback resource is not seekable");
    if (this.#closing || this.#settled) throw new DisTubeError("INVALID_STATE", "Track has no running input");
    const position = await this.#reopen(seconds);
    this.#discardQueued();
    this.#floor = { emitted: this.#emitted, seconds: position };
  }

  #discardQueued(): void {
    const queued = this.packets.readableLength;
    for (let index = 0; index < queued; index += 1) this.packets.read();
    this.#emitted -= queued;
    this.#pts.length -= queued;
  }

  async #reopen(seconds: number): Promise<number> {
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
      const server = this.#servers.get(input) as ByteServer;
      if (controller.signal.aborted) {
        this.#servers.delete(input);
        server.close();
        throw superseded(controller.signal);
      }
      const { source } = server;
      const settled = await this.#call(request => ({ type: "seek", track: this.#id, request, input, source, seconds }));
      if (settled.superseded)
        throw controller.signal.aborted
          ? superseded(controller.signal)
          : new DisTubeError("INVALID_STATE", "Track ended before the seek was applied");
      if (settled.error) throw this.#failure("seek", settled.error, settled.input);
      this.#inputEnded = false;
      this.#lost = undefined;
      return settled.position ?? seconds;
    } finally {
      this.#seeks -= 1;
      if (this.#seekController === controller) this.#seekController = undefined;
      if (this.#seeks === 0) this.#recover();
      this.#checkEnd();
    }
  }

  #recover(): void {
    const lost = this.#lost;
    if (!lost || this.#closing || this.#settled) return;
    if (this.#emitted > this.#reopenedAt) this.#reopens = 0;
    this.#reopenedAt = this.#emitted;
    if (!this.#seekable || this.#reopens === MAX_REOPENS) {
      this.#fail("read", this.#failure("read", lost.error, lost.input));
      return;
    }
    this.#reopens += 1;
    void this.#reopen(lost.position).catch(() => undefined);
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
    const deadline = setTimeout(() => this.#lease.abandon(), CLOSE_TIMEOUT_MS);
    await this.#closedSignal;
    clearTimeout(deadline);
    for (const server of this.#servers.values()) server.close();
    this.#lease.detach();
  }

  #reply(input: number, message: ByteReply): void {
    this.#lease.post({ type: "bytes", input, ...message }, message.chunk ? [message.chunk] : []);
  }

  async #serve(seconds: number, signal: AbortSignal): Promise<number> {
    const input = ++nextId;
    const server = await serveInput(
      this.#resource,
      seconds,
      signal,
      this.#redact,
      message => this.#reply(input, message),
      offset => this.#retried(offset),
    );
    if (this.#closing) {
      server.close();
      throw abortError();
    }
    if (server.source.kind !== "ranged" && this.#resource.kind === "url") {
      server.close();
      throw new Error("Playback URL ignored the byte range");
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

  readonly #receive = (message: FromWorker | WorkerLoss): void => {
    switch (message.type) {
      case "worker-lost": {
        const error = decodeFailure("worker", message.error, this.#redact);
        this.#opened.reject(error);
        this.#fail("worker", error);
        return;
      }
      case "opened":
        this.#opened.resolve();
        return;
      case "packets":
        this.#fed();
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
      case "lost":
        this.#lost = message;
        if (this.#seeks === 0) this.#recover();
        return;
      case "failed": {
        const error = this.#failure(message.stage, message.error, message.input);
        this.#opened.reject(error);
        this.#fail(message.stage, error);
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

  #starve(): void {
    if (this.#emitted > 0 && !this.#inputEnded && !this.#settled && !this.#closing) {
      this.#starvedSince ??= performance.now();
    }
  }

  #fed(): void {
    const since = this.#starvedSince;
    if (since === undefined) return;
    this.#starvedSince = undefined;
    const durationMs = Math.round(performance.now() - since);
    if (durationMs < STARVED_REPORT_MS || this.#settled) return;
    this.#report("warning", "engine.track.starved", `Playback had no audio for ${durationMs} ms`, { durationMs });
  }

  #retried(offset: number): void {
    this.#retries += 1;
    this.#report("warning", "engine.input.retried", "A range answer ended early, so the engine reopened it", {
      offset,
      attempt: this.#retries,
    });
  }

  #report(severity: DiagnosticSeverity, stage: string, message: string, data: Diagnostic["data"]): void {
    this.#reporter.report({
      severity,
      stage,
      message,
      guildId: this.#reporter.guildId,
      position: this.position,
      data,
    });
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

  #fail(step: string, error: Error): void {
    if (this.#settled || this.#closing) return;
    this.#stopHold();
    this.packets.destroy();
    failedSteps.set(error, step);
    this.#resolve({ type: "failed", step, error });
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
  const { promise, resolve, reject } = Promise.withResolvers<Extract<FromWorker, { type: "settled" | "failed" }>>();
  const lease = attach(track, message => {
    if (message.type === "worker-lost") reject(message.error);
    else if (message.type === "settled" || message.type === "failed") resolve(message);
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

class Packets extends Readable {
  readonly #onEmpty: () => void;

  constructor(readAhead: number, grant: () => void, onEmpty: () => void) {
    super({ objectMode: true, highWaterMark: readAhead, read: grant });
    this.#onEmpty = onEmpty;
  }

  override read(size?: number): unknown {
    const packet: unknown = super.read(size);
    if (packet === null && size === undefined) this.#onEmpty();
    return packet;
  }
}

type WorkerLoss = Readonly<{ type: "worker-lost"; track: number; error: Error }>;
type Listener = (message: FromWorker | WorkerLoss) => void;

interface Hosted {
  readonly listener: Listener;
  readonly report?: Report;
}

interface Thread {
  readonly worker: Worker;
  readonly tracks: Map<number, Hosted>;
  readonly permits: Set<number>;
  idle?: NodeJS.Timeout;
  load?: EventLoopUtilization;
}

interface Lease {
  post(message: ToWorker, transfer?: readonly ArrayBuffer[]): void;
  detach(): void;
  abandon(): void;
}

const threads: Thread[] = [];
let queued: { readonly thread: Thread; readonly permit: number }[] = [];
let available = PERMITS;
let loadSampler: NodeJS.Timeout | undefined;
let loadReadable = true;

function attach(track: number, listener: Listener, report?: Report): Lease {
  const thread = pick();
  clearTimeout(thread.idle);
  thread.idle = undefined;
  thread.tracks.set(track, { listener, report });
  thread.worker.ref();
  sampleLoadWhileHosting();
  return {
    post: (message, transfer = []) => thread.worker.postMessage(message, transfer),
    detach: () => {
      const detached = thread.tracks.delete(track);
      sampleLoadWhileHosting();
      if (!detached || thread.tracks.size > 0 || !threads.includes(thread)) return;
      thread.worker.unref();
      thread.idle = setTimeout(() => retire(thread), IDLE_EXIT_MS).unref();
    },
    abandon: () => {
      lose(thread, new Error(`Playback worker did not close a track within ${CLOSE_TIMEOUT_MS} ms`));
      // Not terminate(), for the reason at retire(); a stuck worker leaks until its native call returns.
      thread.worker.postMessage({ type: "exit" } satisfies ToWorker, []);
      thread.worker.unref();
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
    else thread.tracks.get(message.track)?.listener(message);
  });
  worker.on("error", (error: Error) => lose(thread, error));
  worker.on("exit", (code: number) => lose(thread, new Error(`Playback worker exited with code ${code}`)));
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

function lose(thread: Thread, error: Error): void {
  const index = threads.indexOf(thread);
  if (index >= 0) threads.splice(index, 1);
  clearTimeout(thread.idle);
  queued = queued.filter(entry => entry.thread !== thread);
  available += thread.permits.size;
  thread.permits.clear();
  grantQueued();
  const tracks = [...thread.tracks];
  thread.tracks.clear();
  sampleLoadWhileHosting();
  for (const [track, { listener }] of tracks) {
    listener({ type: "worker-lost", track, error });
    listener({ type: "closed", track });
  }
}

function sampleLoadWhileHosting(): void {
  if (loadReadable && threads.some(thread => thread.tracks.size > 0)) {
    loadSampler ??= setInterval(sampleLoad, LOAD_INTERVAL_MS).unref();
    return;
  }
  clearInterval(loadSampler);
  loadSampler = undefined;
  // A long-lived worker's first sample after a restart spans its whole life; a per-thread baseline at start would fix it.
  for (const thread of threads) thread.load = undefined;
}

function sampleLoad(): void {
  for (const thread of threads) {
    let load: EventLoopUtilization;
    try {
      const { performance } = thread.worker;
      const current = performance.eventLoopUtilization();
      load = thread.load ? performance.eventLoopUtilization(current, thread.load) : current;
      thread.load = current;
    } catch {
      // Bun does not implement Worker#performance and throws on reading it.
      loadReadable = false;
      sampleLoadWhileHosting();
      return;
    }
    const reports = new Set<Report>();
    for (const { report } of thread.tracks.values()) if (report) reports.add(report);
    if (reports.size === 0) continue;
    const { threadId } = thread.worker;
    const utilization = Number.isFinite(load.utilization) ? load.utilization : 0;
    const diagnostic: Diagnostic = {
      severity: utilization >= 0.9 ? "warning" : "debug",
      stage: "engine.worker.load",
      message: `Playback worker ${threadId} was busy ${Math.round(utilization * 100)}% of the last interval`,
      data: { threadId, tracks: thread.tracks.size, utilization },
    };
    for (const report of reports) report(diagnostic);
  }
}
