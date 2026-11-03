import { availableParallelism } from "node:os";
import type { EventLoopUtilization } from "node:perf_hooks";
import { Readable } from "node:stream";
import { Worker } from "node:worker_threads";
import { DisTubeError } from "distube";
import type { Diagnostic } from "distube/integrations";
import type { FromWorker, PermitMessage, ToWorker, WireError } from "./protocol";
import {
  abortError,
  type ByteReply,
  type ByteServer,
  decodeFailure,
  fromWire,
  inputFailure,
  type LocalPlaybackResource,
  redactor,
  safeError,
  serveInput,
  StalledInput,
} from "./sources";

const HOLD_POLL_MS = 20;
const IDLE_EXIT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000;
const STARVED_REPORT_MS = 100;
const LOAD_INTERVAL_MS = 30_000;
const GAPS_REPORT_MS = 3_600_000;
const PACKET_MS = 20;
const STARVED_LIMIT_FRAMES = 15_000 / PACKET_MS;
const REOPEN_DELAYS_MS = [0, 1_000, 2_000, 4_000];
const REOPEN_INTERVAL_MS = 8_000;
const REOPEN_BUDGET_MS = 30_000;
const BUDGET_RESTART_PACKETS = 30_000 / PACKET_MS;
const BEHIND_LIMIT_MS = 5_000;
const MAX_PTS_STEP_S = 1;
const POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1));
// Unset, libuv starts 4 threads while Bun sizes its N-API pool to the CPUs.
const THREADPOOL_SIZE = Number(process.env.UV_THREADPOOL_SIZE) || (process.versions.bun ? availableParallelism() : 4);
const PERMITS = Math.max(1, THREADPOOL_SIZE - 1);
const ENTRY = new URL(`./worker.${import.meta.url.endsWith(".ts") ? "ts" : "mjs"}`, import.meta.url);

type FailedData = Extract<Diagnostic, { stage: "engine.track.failed" }>["data"];
type ReopenData = Extract<Diagnostic, { stage: "engine.input.reopened" }>["data"];
export type TrackStep = FailedData["step"];
export type Recovery = FailedData["recovery"];

export type TrackOutcome =
  | Readonly<{ type: "ended" }>
  | Readonly<{ type: "closed" }>
  | Readonly<{ type: "failed"; step: TrackStep; error: Error; recovery: Recovery }>;

type Report = (diagnostic: Diagnostic) => void;

const failedSteps = new WeakMap<Error, TrackStep>();

export function openFailureStep(error: unknown): TrackStep {
  return (error instanceof Error && failedSteps.get(error)) || "open";
}

export interface TrackReporter {
  readonly guildId: string;
  readonly report: Report;
}

export interface TrackSettings {
  readonly volume: number;
  readonly chain: string | undefined;
  readonly bitrate: number;
  readonly opusComplexity: number;
  readonly readAhead: number;
}

type Settled = Extract<FromWorker, { type: "settled" }>;

interface Broken {
  readonly reason: Exclude<ReopenData["reason"], "resumed" | "behind">;
  readonly position: number;
  readonly error: Error;
}

interface Budget {
  readonly since: number;
  attempts: number;
  failure: Error;
}

type Reopened = Error | "opened" | "ended";

let nextId = 0;

export class Track {
  readonly packets: Readable;
  readonly outcome: Promise<TrackOutcome>;
  readonly #id = ++nextId;
  readonly #readAhead: number;
  readonly #resource: LocalPlaybackResource;
  readonly #seekable: boolean;
  readonly #reopenable: boolean;
  readonly #live: boolean;
  readonly #redact: (value: string) => string;
  readonly #reporter: TrackReporter;
  readonly #lease: Lease;
  readonly #servers = new Map<number, ByteServer>();
  readonly #retiredFailures = new Map<number, Error>();
  readonly #requests = new Map<number, (settled: Settled) => void>();
  readonly #pts: number[] = [];
  readonly #clock: number[] = [];
  readonly #gapReports: NodeJS.Timeout;
  #ptsStart = 0;
  #lastPts?: number;
  #elapsed = 0;
  #emitted = 0;
  #granted = 0;
  #floor?: { readonly emitted: number; readonly seconds: number };
  #counter?: () => number;
  #opened!: { resolve(): void; reject(error: Error): void };
  #closed!: () => void;
  readonly #closedSignal: Promise<void>;
  #seeks = 0;
  #seekController?: AbortController;
  #broken?: Broken;
  #budget?: Budget;
  #retry?: NodeJS.Timeout;
  #reopens = 0;
  #reopenedAt = 0;
  #edge?: { readonly at: number; readonly played: number };
  #caughtUpAt?: number;
  #paused = false;
  #retries = 0;
  #starvedSince?: number;
  #missed = 0;
  #gapOpen = false;
  #gaps = 0;
  #silentFrames = 0;
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
    this.#live = resource.kind === "live";
    this.#seekable =
      resource.kind === "url" ? first.source.kind === "ranged" : resource.kind !== "stream" && !this.#live;
    this.#reopenable = this.#seekable || this.#live;
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
    this.#gapReports = setInterval(() => this.#reportGaps(), GAPS_REPORT_MS).unref();
    this.#lease = attach(this.#id, this.#receive, reporter.report);
  }

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
    let server: ByteServer | undefined;
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
      throw error instanceof DisTubeError || isAbort(error) ? error : inputFailure(safeError(error, redact));
    }
    if (!server) throw new DisTubeError("SOURCE_FAILED", "Live input ended before the track started");
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

  get position(): number {
    const played = this.#played();
    this.#forget(played);
    const floor = this.#floor;
    if (floor && played <= floor.emitted) return floor.seconds;
    this.#floor = undefined;
    return this.#at(this.#live ? this.#clock : this.#pts, played);
  }

  get playedSeconds(): number {
    return this.#at(this.#clock, this.#played());
  }

  get reopens(): number {
    return this.#reopens;
  }

  get settled(): boolean {
    return this.#settled;
  }

  setPlayedCounter(counter: () => number): void {
    this.#counter = counter;
  }

  setVolume(percent: number): void {
    if (!this.#closing && !this.#settled) this.#lease.post({ type: "volume", track: this.#id, percent });
  }

  setBitrate(bitrate: number): void {
    if (!this.#closing && !this.#settled) this.#lease.post({ type: "bitrate", track: this.#id, bitrate });
  }

  async setFilters(chain: string | undefined): Promise<void> {
    if (this.#closing || this.#settled) return;
    const settled = await this.#call(request => ({ type: "filters", track: this.#id, request, chain }));
    if (settled.superseded) throw new DisTubeError("INVALID_STATE", "Track ended before the filter chain was applied");
    if (settled.error) throw filterRejection(settled.error, this.#redact);
  }

  async seek(seconds: number): Promise<void> {
    if (!this.#seekable) throw new DisTubeError("UNSUPPORTED", "This playback resource is not seekable");
    if (this.#closing || this.#settled) throw new DisTubeError("INVALID_STATE", "Track has no running input");
    try {
      const position = await this.#reopen(seconds, "seek");
      this.#discardQueued();
      this.#floor = { emitted: this.#emitted, seconds: position ?? seconds };
    } finally {
      this.#recover();
    }
  }

  pause(): void {
    this.#paused = true;
  }

  async resume(): Promise<void> {
    if (!this.#paused) return;
    this.#paused = false;
    if (!this.#live || this.#closing || this.#settled) return;
    if (this.#broken || this.#seeks > 0) this.#discardQueued();
    else await this.#toEdge("resumed");
  }

  #discardQueued(): void {
    const queued = this.packets.readableLength;
    for (let index = 0; index < queued; index += 1) this.packets.read();
    this.#emitted -= queued;
    this.#pts.length -= queued;
    this.#clock.length -= queued;
    this.#elapsed = this.#clock.at(-1) ?? 0;
    this.#lastPts = undefined;
  }

  async #reopen(seconds: number, purpose: "seek" | "reopen"): Promise<number | undefined> {
    this.#seekController?.abort();
    const controller = new AbortController();
    this.#seekController = controller;
    this.#seeks += 1;
    try {
      let input: number | undefined;
      try {
        input = await this.#serve(seconds, controller.signal);
      } catch (error: unknown) {
        if (controller.signal.aborted) throw superseded(controller.signal);
        throw purpose === "seek" ? decodeFailure("seek", error, this.#redact) : safeError(error, this.#redact);
      }
      if (input === undefined) return undefined;
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
      if (settled.error) {
        const local = this.#localFailure(settled.input);
        if (purpose === "reopen" && local) throw local;
        throw this.#failure(purpose === "seek" ? "seek" : "open", settled.error, local);
      }
      this.#inputEnded = false;
      this.#broken = undefined;
      this.#lastPts = undefined;
      this.#reopenedAt = this.#played();
      this.#markEdge();
      return settled.position ?? seconds;
    } finally {
      this.#seeks -= 1;
      if (this.#seekController === controller) this.#seekController = undefined;
      this.#checkEnd();
    }
  }

  #broke(broken: Broken): void {
    if (this.#broken) return;
    this.#charge(broken.error);
    this.#broken = broken;
    this.#recover();
  }

  #currentBudget(): Budget | undefined {
    return this.#played() - this.#reopenedAt < BUDGET_RESTART_PACKETS ? this.#budget : undefined;
  }

  #charge(failure: Error): Budget {
    const budget = this.#currentBudget();
    if (budget) {
      budget.failure = chained(failure, budget.failure);
      return budget;
    }
    this.#budget = { since: performance.now(), attempts: 0, failure };
    return this.#budget;
  }

  #recover(): void {
    const budget = this.#budget;
    if (!this.#broken || !budget || this.#seeks > 0 || this.#retry || this.#closing || this.#settled) return;
    if (!this.#reopenable) return this.#giveUp(budget, "unreopenable");
    const delay = REOPEN_DELAYS_MS[budget.attempts] ?? REOPEN_INTERVAL_MS;
    if (performance.now() + delay - budget.since > REOPEN_BUDGET_MS) return this.#giveUp(budget, "exhausted");
    if (delay === 0) {
      void this.#reopenBroken();
      return;
    }
    this.#retry = setTimeout(() => {
      this.#retry = undefined;
      void this.#reopenBroken();
    }, delay);
  }

  async #reopenBroken(): Promise<void> {
    const broken = this.#broken;
    const budget = this.#budget;
    if (!broken || !budget || this.#seeks > 0 || this.#closing || this.#settled) return;
    budget.attempts += 1;
    const reopened = await this.#attempt(broken.reason, budget.attempts, this.#live ? 0 : broken.position);
    if (reopened instanceof Error) {
      budget.failure = chained(reopened, budget.failure);
      if (this.#broken === broken) this.#broken = { ...broken, reason: "failed" };
    } else if (reopened === "ended") {
      this.#broken = undefined;
      this.#inputEnded = true;
      this.#checkEnd();
    }
    this.#recover();
  }

  async #toEdge(reason: "resumed" | "behind"): Promise<void> {
    const reopened = await this.#attempt(reason, (this.#currentBudget()?.attempts ?? 0) + 1, 0);
    if (reopened === undefined) return;
    if (reason === "resumed" || reopened === "opened") this.#discardQueued();
    if (reopened instanceof Error) {
      this.#charge(reopened).attempts += 1;
      this.#broken ??= { reason: "failed", position: 0, error: reopened };
      this.#recover();
      return;
    }
    if (reopened === "ended") {
      this.#inputEnded = true;
      this.#checkEnd();
    }
  }

  async #attempt(reason: ReopenData["reason"], attempt: number, seconds: number): Promise<Reopened | undefined> {
    this.#reopens += 1;
    let reopened: Reopened;
    try {
      reopened = (await this.#reopen(seconds, "reopen")) === undefined ? "ended" : "opened";
    } catch (error: unknown) {
      if (this.#closing || this.#settled || DisTubeError.is(error, "ABORTED")) return undefined;
      reopened = error instanceof Error ? error : new Error("Non-error cause");
    }
    this.#reportReopen(reason, attempt, reopened);
    return reopened;
  }

  #reportReopen(reason: ReopenData["reason"], attempt: number, reopened: Reopened): void {
    const severity = reason === "resumed" || reason === "behind" ? "info" : "warning";
    const data = { kind: this.#resource.kind, attempt, reason };
    if (reopened instanceof Error) {
      this.#report({
        severity,
        stage: "engine.input.reopened",
        message: `Reopening the playback input (${reason}) failed: ${reopened.message}`,
        data: { ...data, outcome: "failed" },
        error: reopened,
      });
    } else {
      this.#report({
        severity,
        stage: "engine.input.reopened",
        message: `Reopened the playback input (${reason}): ${reopened}`,
        data: { ...data, outcome: reopened },
      });
    }
  }

  #giveUp(budget: Budget, recovery: Exclude<Recovery, "none">): void {
    this.#fail("read", inputFailure(budget.failure), recovery);
  }

  #markEdge(): void {
    if (this.#live) this.#edge = { at: performance.now(), played: this.#played() };
  }

  #checkBehind(): void {
    const edge = this.#edge;
    if (!edge || this.#paused || this.#broken || this.#seeks > 0 || this.#closing || this.#settled) return;
    const played = this.#played();
    if (this.#caughtUpAt !== undefined && played - this.#caughtUpAt < BUDGET_RESTART_PACKETS) return;
    if (performance.now() - edge.at - (played - edge.played) * PACKET_MS <= BEHIND_LIMIT_MS) return;
    this.#caughtUpAt = played;
    void this.#toEdge("behind");
  }

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

  async #serve(seconds: number, signal: AbortSignal): Promise<number | undefined> {
    const input = ++nextId;
    const server = await serveInput(
      this.#resource,
      seconds,
      signal,
      this.#redact,
      message => this.#reply(input, message),
      offset => this.#retried(offset),
    );
    if (!server) return undefined;
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

  /** Readable reads again only after a push, so a full queue still asks for the one it hands out. */
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
        this.#fail("worker", error, "none");
        return;
      }
      case "opened":
        this.#markEdge();
        this.#opened.resolve();
        return;
      case "packets":
        this.#fed();
        this.#granted = Math.max(0, this.#granted - message.packets.length);
        for (const [index, packet] of message.packets.entries()) {
          if (this.#settled || this.#inputEnded) return;
          const pts = message.pts[index] ?? 0;
          this.#pts.push(pts);
          this.#clock.push(this.#advance(pts));
          this.#emitted += 1;
          this.packets.push(Buffer.from(packet));
        }
        this.#forget(this.#played());
        this.#checkBehind();
        return;
      case "settled":
        this.#requests.get(message.request)?.(message);
        this.#requests.delete(message.request);
        return;
      case "ended":
        if (this.#live) this.#broke({ reason: "ended", position: 0, error: new Error("Live input ended") });
        else {
          this.#inputEnded = true;
          this.#checkEnd();
        }
        return;
      case "lost": {
        const error = this.#localFailure(message.input) ?? safeError(fromWire(message.error), this.#redact);
        const reason = error instanceof StalledInput ? "stalled" : "failed";
        this.#broke({ reason, position: message.position, error });
        return;
      }
      case "failed": {
        const local = this.#localFailure(message.input);
        const error =
          message.stage === "open" && local ? inputFailure(local) : this.#failure(message.stage, message.error, local);
        this.#opened.reject(error);
        this.#fail(message.stage, error, "none");
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

  #localFailure(input: number | undefined): Error | undefined {
    if (input === undefined) return undefined;
    const local = this.#retiredFailures.get(input) ?? this.#servers.get(input)?.failure;
    this.#retiredFailures.delete(input);
    return local;
  }

  #failure(stage: string, error: WireError, local: Error | undefined): Error {
    if (!local && (error.code === "INVALID_ARGUMENT" || error.code === "SOURCE_FAILED")) {
      return new DisTubeError(error.code, error.message, {
        cause: error.cause ? safeError(fromWire(error.cause), this.#redact) : undefined,
      });
    }
    return decodeFailure(stage, local ?? fromWire(error), this.#redact);
  }

  /** @discordjs/voice's AudioPlayer sends one 20 ms silence frame for each read that finds no packet. */
  #starve(): void {
    if (this.#emitted === 0 || this.#inputEnded || this.#settled || this.#closing) return;
    this.#silentFrames += 1;
    if (!this.#gapOpen) {
      this.#gapOpen = true;
      this.#gaps += 1;
    }
    this.#starvedSince ??= performance.now();
    if (this.#broken || this.#seeks > 0) this.#missed = 0;
    else if (++this.#missed > STARVED_LIMIT_FRAMES)
      this.#fail("starved", new Error("Playback stopped before the track ended: no audio for 15 seconds"), "none");
  }

  #fed(): void {
    this.#missed = 0;
    this.#gapOpen = false;
    const since = this.#starvedSince;
    if (since === undefined) return;
    this.#starvedSince = undefined;
    const durationMs = Math.round(performance.now() - since);
    if (durationMs < STARVED_REPORT_MS || this.#settled) return;
    this.#report({
      severity: "warning",
      stage: "engine.track.starved",
      message: `Playback had no audio for ${durationMs} ms`,
      data: { durationMs },
    });
  }

  #reportGaps(): void {
    if (this.#gaps === 0) return;
    const silentMs = this.#silentFrames * PACKET_MS;
    this.#report({
      severity: "info",
      stage: "engine.track.gaps",
      message: `Playback had ${this.#gaps} gaps, ${silentMs} ms in total`,
      data: { gaps: this.#gaps, silentMs },
    });
    this.#gaps = 0;
    this.#silentFrames = 0;
    this.#gapOpen = false;
  }

  #retried(offset: number): void {
    this.#retries += 1;
    this.#report({
      severity: "warning",
      stage: "engine.input.retried",
      message: "A range answer ended early, so the engine reopened it",
      data: { offset, attempt: this.#retries },
    });
  }

  #report(diagnostic: Diagnostic): void {
    this.#reporter.report({ ...diagnostic, guildId: this.#reporter.guildId, position: this.position });
  }

  #played(): number {
    const played = this.#counter ? Math.floor(this.#counter()) : this.#emitted - this.packets.readableLength;
    return Number.isFinite(played) ? Math.min(Math.max(played, 0), this.#emitted) : 0;
  }

  #at(values: readonly number[], played: number): number {
    return played === 0 ? 0 : (values[played - 1 - this.#ptsStart] ?? 0);
  }

  #advance(pts: number): number {
    const step = this.#lastPts === undefined ? Number.NaN : pts - this.#lastPts;
    this.#lastPts = pts;
    this.#elapsed += step >= 0 && step <= MAX_PTS_STEP_S ? step : PACKET_MS / 1000;
    return this.#elapsed;
  }

  #forget(played: number): void {
    const stale = played - 1 - this.#ptsStart;
    if (stale <= 0) return;
    this.#pts.splice(0, stale);
    this.#clock.splice(0, stale);
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

  #fail(step: TrackStep, error: Error, recovery: Recovery): void {
    if (this.#settled || this.#closing) return;
    this.#stopHold();
    this.packets.destroy();
    failedSteps.set(error, step);
    this.#resolve({ type: "failed", step, error, recovery });
  }

  #resolve(outcome: TrackOutcome): void {
    if (this.#settled) return;
    this.#settled = true;
    clearTimeout(this.#retry);
    this.#retry = undefined;
    clearInterval(this.#gapReports);
    this.#reportGaps();
    this.#settle(outcome);
  }
}

function chained(error: Error, previous: Error): Error {
  const cause = error.cause instanceof Error ? chained(error.cause, previous) : previous;
  const link = new Error(error.message, { cause });
  link.name = error.name;
  return link;
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
