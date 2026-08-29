import { randomUUID } from "node:crypto";
import type { ResolvableInput, VoiceTarget } from "./contracts";
import { ErrorReason } from "./enums";
import { abortFailure, DisTubeError, ErrorCode } from "./errors";
import type { DisTubeEventEmitter } from "./events";
import { type GuildQueue, GuildQueueImpl } from "./GuildQueue";
import type { QueueItem } from "./media";
import { resolveInput } from "./playback/resolve";
import type { SourceCatalog } from "./playback/sources";
import { cleanupFailure } from "./queue/failures";
import type { QueueTerminalCause } from "./queue/terminal";
import type { QueueVoice } from "./queue/voice";
import { settleAll } from "./utils/dispose";

/** Readonly view over the registered GuildQueues, published as `distube.queues`. */
export type QueueCollection<Metadata = unknown> = Readonly<{
  readonly size: number;
  [Symbol.iterator](): IterableIterator<GuildQueue<Metadata>>;
}>;

/** Package-private input accepted by QueueManager's ordered play lane. */
interface QueuePlayTarget {
  readonly guildId: string;
  readonly voiceChannelId: string;
}

/** Package-private options QueueManager passes to a committed queue insertion. */
interface QueuePlayOptions {
  readonly position?: number;
  readonly metadata?: unknown;
  readonly skip?: boolean;
  readonly signal?: AbortSignal;
}

/** Package-private result returned through the public `DisTube.play` facade. */
interface QueuePlayResult {
  readonly queue: GuildQueue;
  readonly items: readonly QueueItem[];
}

interface PlayInvocation {
  readonly guildId: string;
  readonly controller: AbortController;
  /** The controller's signal, joined with the caller's when one was supplied. */
  readonly signal: AbortSignal;
}

interface DeletionRecord {
  readonly queues: readonly GuildQueueImpl[];
  readonly completion: Promise<void>;
}

/** @internal */
export class QueueManager {
  readonly #moveVoice: (target: VoiceTarget) => Promise<QueueVoice>;
  readonly #getVoice: (guildId: string) => QueueVoice | undefined;
  readonly #assertVoiceJoinable: (guildId: string) => void;
  readonly #releaseOwnedVoice: (voice: QueueVoice) => Promise<void>;
  readonly #sources: SourceCatalog;
  readonly #events: DisTubeEventEmitter;
  readonly #queues = new Map<string, GuildQueueImpl>();
  /** Queues that exist only while their first insertion is still transactional. */
  readonly #provisional = new Map<string, GuildQueueImpl>();
  /** One promise tail per guild keeps play calls in invocation order. */
  readonly #lanes = new Map<string, Promise<void>>();
  readonly #inFlight = new Set<PlayInvocation>();
  /** Queue completions remain observable after synchronous unregistration. */
  readonly #cleanup = new Map<string, Set<Promise<void>>>();
  /** The current terminal join for a guild. A replacement queue gets its own record after the old one unregisters. */
  readonly #deleting = new Map<string, DeletionRecord>();
  readonly view: QueueCollection;
  #fenced = false;

  constructor(
    moveVoice: (target: VoiceTarget) => Promise<QueueVoice>,
    getVoice: (guildId: string) => QueueVoice | undefined,
    assertVoiceJoinable: (guildId: string) => void,
    releaseOwnedVoice: (voice: QueueVoice) => Promise<void>,
    sources: SourceCatalog,
    events: DisTubeEventEmitter,
  ) {
    this.#moveVoice = moveVoice;
    this.#getVoice = getVoice;
    this.#assertVoiceJoinable = assertVoiceJoinable;
    this.#releaseOwnedVoice = releaseOwnedVoice;
    this.#sources = sources;
    this.#events = events;
    const queues = this.#queues;
    const view = {
      get size(): number {
        return queues.size;
      },
      *[Symbol.iterator](): IterableIterator<GuildQueue> {
        for (const queue of queues.values()) yield queue.facade;
      },
    };
    Object.freeze(view);
    this.view = view;
  }

  /** Serializes all play work for a guild without exposing a transaction object publicly. */
  play(target: QueuePlayTarget, input: ResolvableInput, options: QueuePlayOptions = {}): Promise<QueuePlayResult> {
    let voiceTarget: VoiceTarget;
    try {
      voiceTarget = toVoiceTarget(target);
      this.#assertReady();
      this.#assertVoiceJoinable(voiceTarget.guildId);
      validatePlayOptions(options);
    } catch (error: unknown) {
      return Promise.reject(error);
    }

    const invocation = this.#invocation(voiceTarget.guildId, options.signal);
    const invocationOptions: QueuePlayOptions = Object.freeze({
      position: options.position,
      metadata: options.metadata,
      skip: options.skip,
      signal: invocation.signal,
    });
    // Register the invocation before its lane turn. A terminal deletion can then abort a resolution that
    // has not reached the front of the lane yet.
    this.#inFlight.add(invocation);
    const previous = this.#lanes.get(voiceTarget.guildId) ?? Promise.resolve();
    const operation = previous.then(() => this.#runPlay(voiceTarget, input, invocationOptions, invocation));
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.#lanes.set(voiceTarget.guildId, tail);
    void tail.then(() => {
      if (this.#lanes.get(voiceTarget.guildId) === tail) this.#lanes.delete(voiceTarget.guildId);
    });
    void operation.finally(() => this.#inFlight.delete(invocation)).catch(() => undefined);
    return operation;
  }

  get(guildId: string): GuildQueue | undefined {
    return this.#queues.get(guildId)?.facade;
  }

  /**
   * Installs terminal authority on both live and provisional queues before waiting for the guild play lane.
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
    const record: DeletionRecord = Object.freeze({ queues, completion });
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
    for (const invocation of this.#inFlight) invocation.controller.abort(this.#shutdownError());
  }

  /** Fences every current guild synchronously, then joins queue cleanup and every play lane. */
  deleteAll(cause: QueueTerminalCause = { kind: "shutdown" }): Promise<readonly Error[]> {
    const guilds = new Set([
      ...this.#queues.keys(),
      ...this.#provisional.keys(),
      ...this.#lanes.keys(),
      ...this.#cleanup.keys(),
      ...this.#deleting.keys(),
    ]);
    const completions = [...guilds].map(guildId => this.delete(guildId, cause));
    return settleAll(completions.map(completion => () => completion));
  }

  async #runPlay(
    target: VoiceTarget,
    input: ResolvableInput,
    options: QueuePlayOptions,
    invocation: PlayInvocation,
  ): Promise<QueuePlayResult> {
    this.#assertReady();
    this.#assertInvocation(invocation);
    this.#assertVoiceJoinable(target.guildId);
    const existing = this.#queues.get(target.guildId);
    const queue = existing ?? this.#createProvisional(target);
    const ownsQueue = !existing;
    let ownedVoice: QueueVoice | undefined;
    let committed = existing === queue;

    try {
      const media = await resolveInput(input, this.#sources, invocation.signal);
      this.#assertReady();
      this.#assertInvocation(invocation);
      this.#assertVoiceJoinable(target.guildId);

      const previousVoice = this.#getVoice(target.guildId);
      const voice = await this.#moveVoice(target);
      if (!previousVoice && this.#getVoice(target.guildId) === voice) ownedVoice = voice;
      this.#assertInvocation(invocation);
      queue.attachVoice(voice);
      this.#assertReady();
      this.#assertInvocation(invocation);

      const currentItemId = queue.state.current?.id;
      const items = await queue.enqueue(media, {
        position: options.position,
        metadata: options.metadata,
        signal: options.signal,
      });
      this.#assertReady();
      this.#assertInvocation(invocation);
      committed ||= this.#queues.get(target.guildId) === queue;
      if (options.skip && currentItemId !== undefined && queue.state.current?.id === currentItemId) {
        await queue.skip();
        this.#assertReady();
        this.#assertInvocation(invocation);
      }
      return Object.freeze({ queue: queue.facade, items });
    } catch (error: unknown) {
      if (!committed && ownsQueue) await this.#rollback(target.guildId, queue, ownedVoice);
      throw error;
    }
  }

  /** Makes a queue visible only when GuildQueue has committed its first insertion. */
  #createProvisional(target: VoiceTarget): GuildQueueImpl {
    let queue!: GuildQueueImpl;
    queue = new GuildQueueImpl(
      { queueId: randomUUID(), guildId: target.guildId },
      this.#sources,
      this.#events,
      completion => this.#unregister(target.guildId, queue, completion),
      () => this.#promote(target.guildId, queue),
    );
    this.#provisional.set(target.guildId, queue);
    return queue;
  }

  /** Publishes queue creation after the first insertion's QueueState commit and before its item event. */
  #promote(guildId: string, queue: GuildQueueImpl): void {
    this.#assertReady();
    if (this.#provisional.get(guildId) !== queue) {
      throw new DisTubeError(ErrorCode.QUEUE_FAILED, "Queue operation was superseded");
    }
    this.#provisional.delete(guildId);
    this.#queues.set(guildId, queue);
    this.#events.emit("queue.created", Object.freeze({ guildId, queue: queue.facade, timestamp: Date.now() }));
  }

  /** Rolls back only a still-provisional queue and the Voice created for that same invocation. */
  async #rollback(guildId: string, queue: GuildQueueImpl, ownedVoice: QueueVoice | undefined): Promise<void> {
    if (this.#provisional.get(guildId) === queue) {
      try {
        await queue.destroy({ kind: "rollback" });
      } catch (error: unknown) {
        this.#reportRollbackFailure(guildId, "queue", error);
      }
    }
    if (
      ownedVoice &&
      this.#getVoice(guildId) === ownedVoice &&
      !this.#queues.has(guildId) &&
      !this.#provisional.has(guildId)
    ) {
      try {
        await this.#releaseOwnedVoice(ownedVoice);
      } catch (error: unknown) {
        this.#reportRollbackFailure(guildId, "voice", error);
      }
    }
  }

  /** Frees a live or provisional queue and records its cleanup before it begins settling. */
  #unregister(guildId: string, queue: GuildQueueImpl, completion: Promise<void>): void {
    if (this.#queues.get(guildId) === queue) this.#queues.delete(guildId);
    if (this.#provisional.get(guildId) === queue) this.#provisional.delete(guildId);
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

  #currentQueues(guildId: string): readonly GuildQueueImpl[] {
    return [
      ...new Set([this.#queues.get(guildId), this.#provisional.get(guildId)].filter(Boolean)),
    ] as GuildQueueImpl[];
  }

  /** One invocation whose cancellation the caller and a terminal deletion can both request. */
  #invocation(guildId: string, signal: AbortSignal | undefined): PlayInvocation {
    const controller = new AbortController();
    return {
      guildId,
      controller,
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
    };
  }

  #abortGuildPlay(guildId: string): void {
    const error = new DisTubeError(ErrorCode.QUEUE_FAILED, "Play operation was superseded by queue deletion");
    for (const invocation of this.#inFlight) {
      if (invocation.guildId === guildId) invocation.controller.abort(error);
    }
  }

  #assertInvocation(invocation: PlayInvocation): void {
    if (!invocation.signal.aborted) return;
    throw abortFailure(invocation.signal.reason);
  }

  #assertReady(): void {
    if (this.#fenced) throw this.#shutdownError();
  }

  #shutdownError(): DisTubeError {
    return new DisTubeError(ErrorCode.QUEUE_FAILED, "DisTube is shutting down");
  }

  #reportRollbackFailure(guildId: string, owner: "queue" | "voice", error: unknown): void {
    this.#events.report({
      severity: "error",
      stage: `play.rollback.${owner}`,
      message: `Failed to roll back a rejected play's ${owner}`,
      error: error instanceof Error ? error : new Error(String(error)),
      detail: Object.freeze({ guildId }),
    });
  }
}

function sameQueues(left: readonly GuildQueueImpl[], right: readonly GuildQueueImpl[]): boolean {
  return left.length === right.length && left.every((queue, index) => queue === right[index]);
}

function toVoiceTarget(target: QueuePlayTarget): VoiceTarget {
  if (!target || typeof target.guildId !== "string" || target.guildId.length === 0) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "guildId must be a non-empty string");
  }
  if (typeof target.voiceChannelId !== "string" || target.voiceChannelId.length === 0) {
    throw new DisTubeError(
      ErrorCode.INVALID_ARGUMENT,
      ErrorReason.Argument,
      "voiceChannelId must be a non-empty string",
    );
  }
  return Object.freeze({ guildId: target.guildId, channelId: target.voiceChannelId });
}

function validatePlayOptions(options: QueuePlayOptions): void {
  if (!options || typeof options !== "object") {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "play options must be an object");
  }
  if (options.position !== undefined && (!Number.isInteger(options.position) || options.position < 0)) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "position must be a non-negative integer");
  }
}
