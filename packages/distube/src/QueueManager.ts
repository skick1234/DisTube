import { randomUUID } from "node:crypto";
import type { ResolvableInput, VoiceTarget } from "./contracts";
import { type DisTubeQueue, QueueImpl } from "./DisTubeQueue";
import { abortFailure, DisTubeError, ErrorCode } from "./errors";
import type { DisTubeEventEmitter } from "./events";
import { Playlist, type QueueItem, Song } from "./media";
import { resolveInput } from "./playback/resolve";
import type { SourceCatalog } from "./playback/sources";
import { cleanupFailure } from "./queue/failures";
import type { AddOptions } from "./queue/protocol";
import type { QueueTerminalCause } from "./queue/terminal";
import { settleAll } from "./utils/dispose";
import type { VoiceImpl } from "./voice/DisTubeVoice";
import type { VoiceChannelTarget } from "./voice/target";

/** Readonly view over the registered queues, published as `distube.queues`. */
export type QueueCollection<Metadata = unknown, Target = VoiceChannelTarget> = Readonly<{
  readonly size: number;
  [Symbol.iterator](): IterableIterator<DisTubeQueue<Metadata, Target>>;
}>;

interface QueuePlayResult<Target = VoiceChannelTarget> {
  readonly queue: DisTubeQueue<unknown, Target>;
  readonly items: readonly QueueItem[];
}

interface PlayInvocation<Target = VoiceChannelTarget> {
  readonly guildId: string;
  readonly queue: QueueImpl<Target>;
  readonly signal: AbortSignal;
  readonly release: () => void;
  completion?: Promise<QueuePlayResult<Target>>;
}

interface DeletionRecord<Target = VoiceChannelTarget> {
  readonly queues: readonly QueueImpl<Target>[];
  readonly completion: Promise<void>;
}

const ADD_OPTION_KEYS = ["metadata", "signal", "at", "next"];

/** @internal */
export class QueueManager<Target = VoiceChannelTarget> {
  readonly #moveVoice: (target: VoiceTarget) => Promise<VoiceImpl<Target>>;
  readonly #getVoice: (guildId: string) => VoiceImpl<Target> | undefined;
  readonly #assertVoiceJoinable: (guildId: string) => void;
  readonly #sources: SourceCatalog;
  readonly #events: DisTubeEventEmitter<Target>;
  readonly #historySize: number;
  readonly #normalizeTarget: (target: Target) => VoiceTarget;
  readonly #queues = new Map<string, QueueImpl<Target>>();
  /** One promise tail per guild keeps play calls in invocation order. */
  readonly #lanes = new Map<string, Promise<void>>();
  readonly #inFlight = new Set<PlayInvocation<Target>>();
  /** Queue completions remain observable after synchronous unregistration. */
  readonly #cleanup = new Map<string, Set<Promise<void>>>();
  /** The current terminal join for a guild. A replacement queue gets its own record after the old one unregisters. */
  readonly #deleting = new Map<string, DeletionRecord<Target>>();
  readonly view: QueueCollection<unknown, Target>;
  #fenced = false;
  readonly #stops = new WeakMap<QueueImpl<Target>, Promise<void>>();

  constructor(
    moveVoice: (target: VoiceTarget) => Promise<VoiceImpl<Target>>,
    getVoice: (guildId: string) => VoiceImpl<Target> | undefined,
    assertVoiceJoinable: (guildId: string) => void,
    sources: SourceCatalog,
    events: DisTubeEventEmitter<Target>,
    historySize: number,
    normalizeTarget: (target: Target) => VoiceTarget,
  ) {
    this.#moveVoice = moveVoice;
    this.#getVoice = getVoice;
    this.#assertVoiceJoinable = assertVoiceJoinable;
    this.#sources = sources;
    this.#events = events;
    this.#historySize = historySize;
    this.#normalizeTarget = normalizeTarget;
    const queues = this.#queues;
    const view = {
      get size(): number {
        return queues.size;
      },
      *[Symbol.iterator](): IterableIterator<DisTubeQueue<unknown, Target>> {
        for (const queue of queues.values()) yield queue.facade;
      },
    };
    Object.freeze(view);
    this.view = view;
  }

  /** Serializes all play work for a guild without exposing a transaction object publicly. */
  play(target: Target, input: ResolvableInput, options: AddOptions = {}): Promise<DisTubeQueue<unknown, Target>> {
    try {
      this.#assertReady();
      const normalized = this.#normalizeTarget(target);
      validateInput(input, options);
      this.#assertVoiceJoinable(normalized.guildId);
      const queue = this.#queues.get(normalized.guildId) ?? this.#createQueue(normalized.guildId);
      return this.#reserve(queue, input, options, normalized).then(result => result.queue);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  add(queue: QueueImpl<Target>, input: ResolvableInput, options: AddOptions = {}): Promise<readonly QueueItem[]> {
    try {
      this.#assertReady();
      validateInput(input, options);
      if (this.#queues.get(queue.guildId) !== queue || !this.#getVoice(queue.guildId)) {
        throw new DisTubeError("INVALID_STATE", "Adding requires this connected queue");
      }
      return this.#reserve(queue, input, options).then(result => result.items);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  /** One ordering authority for insertion and public voice movement. Work never starts inline. */
  order<Value>(guildId: string, work: () => Promise<Value>): Promise<Value> {
    const previous = this.#lanes.get(guildId) ?? Promise.resolve();
    const operation = previous.then(work);
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.#lanes.set(guildId, tail);
    void tail.then(() => {
      if (this.#lanes.get(guildId) === tail) this.#lanes.delete(guildId);
    });
    return operation;
  }

  #reserve(
    queue: QueueImpl<Target>,
    input: ResolvableInput,
    options: AddOptions,
    target?: VoiceTarget,
  ): Promise<QueuePlayResult<Target>> {
    const reservation = queue.reserve(options.signal);
    const invocation: PlayInvocation<Target> = { guildId: queue.guildId, queue, ...reservation };
    const invocationOptions: AddOptions = Object.freeze({
      metadata: options.metadata,
      signal: invocation.signal,
      ...(options.next ? { at: 0 } : options.at === undefined ? {} : { at: options.at }),
    });
    this.#inFlight.add(invocation);
    const operation = this.order(queue.guildId, () => this.#runPlay(input, invocationOptions, invocation, target));
    invocation.completion = operation;
    queue.publishCreated();
    return operation.finally(() => {
      this.#inFlight.delete(invocation);
      invocation.release();
    });
  }

  get(guildId: string): DisTubeQueue<unknown, Target> | undefined {
    return this.#queues.get(guildId)?.facade;
  }

  /**
   * Installs terminal authority on registered queues before waiting for the guild play lane.
   * A late first-play rollback remains part of that lane, so deletion cannot lose it.
   */
  delete(guildId: string, cause: QueueTerminalCause = { kind: "stop" }): Promise<void> {
    const queues = this.#currentQueues(guildId);
    const ongoing = this.#deleting.get(guildId);
    if (ongoing && sameQueues(ongoing.queues, queues)) return ongoing.completion;
    if (queues.length === 0 && ongoing) return ongoing.completion;

    // A queued or non-cooperative first play belongs to the terminal caller that overtook it.
    // Calls accepted after this stack get a fresh controller and may create the next queue normally.
    this.#abortGuildPlay(guildId);
    const lane = this.#lanes.get(guildId) ?? Promise.resolve();
    const started = queues.map(queue => queue.destroy(cause));
    for (const completion of started) void completion.catch(() => undefined);

    const completion = this.#completeDeletion(guildId, lane, started);
    const record: DeletionRecord<Target> = Object.freeze({ queues, completion });
    this.#deleting.set(guildId, record);
    void completion
      .finally(() => {
        if (this.#deleting.get(guildId) === record) this.#deleting.delete(guildId);
      })
      .catch(() => undefined);
    return completion;
  }

  /** Rejects further play work and aborts resolution that has not committed. */
  fence(): void {
    if (this.#fenced) return;
    this.#fenced = true;
    for (const queue of this.#queues.values()) queue.fenceReservations();
  }

  /** Fences every current guild synchronously, then joins queue cleanup and every play lane. */
  deleteAll(cause: QueueTerminalCause = { kind: "shutdown" }): Promise<readonly Error[]> {
    const guilds = new Set([
      ...this.#queues.keys(),
      ...this.#lanes.keys(),
      ...this.#cleanup.keys(),
      ...this.#deleting.keys(),
    ]);
    const completions = [...guilds].map(guildId => this.delete(guildId, cause));
    return settleAll(completions.map(completion => () => completion));
  }

  async #runPlay(
    input: ResolvableInput,
    options: AddOptions,
    invocation: PlayInvocation<Target>,
    target?: VoiceTarget,
  ): Promise<QueuePlayResult<Target>> {
    const queue = invocation.queue;
    try {
      this.#assertReady();
      this.#assertInvocation(invocation);
      const media = await resolveInput(input, this.#sources, invocation.signal);
      this.#assertReady();
      this.#assertInvocation(invocation);
      // Old terminal effects finish before a new queue may drive this voice.
      await Promise.all([...(this.#cleanup.get(queue.guildId) ?? [])]);
      this.#assertInvocation(invocation);
      if (target) {
        this.#assertVoiceJoinable(queue.guildId);
        const voice = await this.#moveVoice(target);
        this.#assertInvocation(invocation);
        queue.attachVoice(voice);
      }
      const items = await queue.insert(media, options);
      return Object.freeze({ queue: queue.facade, items });
    } catch (error: unknown) {
      const superseded = queue.terminal;
      invocation.release();
      if (queue.empty && this.#queues.get(queue.guildId) === queue) {
        try {
          await queue.destroy({ kind: "rollback" });
        } catch (cleanup: unknown) {
          throw new DisTubeError(
            error instanceof DisTubeError ? error.code : ErrorCode.QUEUE_FAILED,
            "Play failed and cleanup failed",
            { cause: new AggregateError([error, cleanup], "Play and cleanup failures") },
          );
        }
      }
      if (superseded) throw new DisTubeError("INVALID_STATE", "Queue operation was superseded");
      throw error;
    }
  }

  stop(queue: QueueImpl<Target>): Promise<void> {
    const existing = this.#stops.get(queue);
    if (existing) return existing;
    const work = [...this.#inFlight]
      .filter(invocation => invocation.queue === queue)
      .map(invocation => invocation.completion);
    const cleanup = queue.destroy();
    const completion = Promise.allSettled([cleanup, ...work]).then(results => {
      const terminal = results[0];
      if (terminal?.status === "rejected") throw terminal.reason;
    });
    this.#stops.set(queue, completion);
    return completion;
  }

  #createQueue(guildId: string): QueueImpl<Target> {
    const queue: QueueImpl<Target> = new QueueImpl<Target>(
      { queueId: randomUUID(), guildId, historySize: this.#historySize },
      this.#sources,
      this.#events,
      completion => this.#unregister(guildId, queue, completion),
      (input, options) => this.add(queue, input, options),
      () => this.stop(queue),
    );
    const voice = this.#getVoice(guildId);
    if (voice) queue.attachVoice(voice);
    this.#queues.set(guildId, queue);
    return queue;
  }

  /** Frees a registered queue and records its cleanup before it begins settling. */
  #unregister(guildId: string, queue: QueueImpl<Target>, completion: Promise<void>): void {
    if (this.#queues.get(guildId) === queue) this.#queues.delete(guildId);
    const completions = this.#cleanup.get(guildId) ?? new Set<Promise<void>>();
    completions.add(completion);
    this.#cleanup.set(guildId, completions);
    void completion
      .finally(() => {
        completions.delete(completion);
        if (completions.size === 0 && this.#cleanup.get(guildId) === completions) this.#cleanup.delete(guildId);
      })
      .catch(() => undefined);
  }

  async #completeDeletion(guildId: string, lane: Promise<void>, started: readonly Promise<void>[]): Promise<void> {
    // Resolution failures belong to their original play caller. The terminal owner only needs to join its work.
    await lane.catch(() => undefined);
    const failures: Error[] = [];
    const seen = new Set<Promise<void>>();
    while (true) {
      const current = [...new Set([...started, ...(this.#cleanup.get(guildId) ?? [])])].filter(completion => {
        if (seen.has(completion)) return false;
        seen.add(completion);
        return true;
      });
      if (current.length === 0) {
        await Promise.resolve();
        if ([...(this.#cleanup.get(guildId) ?? [])].every(completion => seen.has(completion))) break;
        continue;
      }
      failures.push(...(await settleAll(current.map(completion => () => completion))));
    }
    const failure = cleanupFailure(ErrorCode.QUEUE_FAILED, "Queue cleanup failed", failures, "Queue cleanup failures");
    if (failure) throw failure;
  }

  #currentQueues(guildId: string): readonly QueueImpl<Target>[] {
    const queue = this.#queues.get(guildId);
    return queue ? [queue] : [];
  }

  #abortGuildPlay(guildId: string): void {
    for (const invocation of this.#inFlight) {
      if (invocation.guildId === guildId) invocation.queue.fenceReservations();
    }
  }

  #assertInvocation(invocation: PlayInvocation<Target>): void {
    if (invocation.queue.terminal) throw new DisTubeError("INVALID_STATE", "Queue operation was superseded");
    if (!invocation.signal.aborted) return;
    throw abortFailure(invocation.signal.reason);
  }

  #assertReady(): void {
    if (this.#fenced) throw this.#shutdownError();
  }

  #shutdownError(): DisTubeError {
    return new DisTubeError("INVALID_STATE", "DisTube is disposed");
  }
}

function sameQueues<Target>(left: readonly QueueImpl<Target>[], right: readonly QueueImpl<Target>[]): boolean {
  return left.length === right.length && left.every((queue, index) => queue === right[index]);
}

function validateInput(input: ResolvableInput, options: AddOptions): void {
  if (
    !(input instanceof Song) &&
    !(input instanceof Playlist) &&
    (typeof input !== "string" || input.trim().length === 0)
  ) {
    throw new DisTubeError("INVALID_ARGUMENT", "Input must be a Song, Playlist, URL, or non-empty query");
  }
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(key => !ADD_OPTION_KEYS.includes(key))
  ) {
    throw new DisTubeError("INVALID_ARGUMENT", "Invalid play options");
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new DisTubeError("INVALID_ARGUMENT", "signal must be an AbortSignal");
  }
  if (options.next !== undefined && typeof options.next !== "boolean") {
    throw new DisTubeError("INVALID_ARGUMENT", "next must be a boolean");
  }
  if (options.at !== undefined && (!Number.isInteger(options.at) || options.at < 0)) {
    throw new DisTubeError("INVALID_ARGUMENT", "at must be a non-negative integer");
  }
  if (options.next !== undefined && options.at !== undefined) {
    throw new DisTubeError("INVALID_ARGUMENT", "next and at are mutually exclusive");
  }
  if (options.signal?.aborted) throw abortFailure(options.signal.reason);
}
