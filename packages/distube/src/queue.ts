import type { Plugin, ResolvableInput, TrackEnd, VoiceChannelTarget } from "./contracts";
import {
  abortError,
  DisTubeError,
  ErrorCode,
  requireBoolean,
  requireInteger,
  throwIfAborted,
  toDisTubeError,
} from "./errors";
import type { BaseQueueEvent, DisTubeEventMap, QueueDeleteReason } from "./events";
import type { Guild } from "./guild";
import { Playlist, type QueueItem, queueItem, type Song } from "./media";
import {
  clearUpcoming,
  failFirst,
  finishCurrent,
  IDLE_QUEUE_STATE,
  insertAt,
  jumpTo,
  moveBefore,
  popHistory,
  pushHistory,
  type QueueState,
  type QueueStatus,
  removeItem,
  removeRange,
  type RepeatMode,
  shuffle,
  startFirst,
} from "./queue-state";
import { disposeResource, prepareSong, relatedSong, resolveInput, songsOf, validateInput } from "./sources";
import type { DisTubeVoice } from "./voice";

/** Options for `distube.play` and `queue.add`. */
export interface AddOptions<Metadata = unknown> {
  /** Caller-owned reference stored on every QueueItem the call creates. */
  readonly metadata?: Metadata;
  /** Cancels the insertion; the call then rejects with `ABORTED` and adds nothing. */
  readonly signal?: AbortSignal;
  /** Zero-based position in `upcoming`, evaluated when the insertion commits. Past the end appends. */
  readonly at?: number;
  /** Equivalent to `at: 0`. Mutually exclusive with `at`. */
  readonly next?: boolean;
}

/** A waiting occurrence ID, a one-based position in `upcoming`, or an inclusive one-based range. */
export type RemoveTarget = string | number | Readonly<{ from: number; to: number }>;

export interface JumpOptions {
  /** Re-append the current item and the items before the target instead of sending them to history. */
  readonly requeue?: boolean;
}

interface Attempt {
  readonly item: QueueItem;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  playing: boolean;
}

type QueueEventName = Exclude<keyof DisTubeEventMap, "queue.created" | "voice.disconnected">;

const REPEAT_MODES: readonly unknown[] = ["off", "song", "queue"] satisfies readonly RepeatMode[];

/**
 * One guild's schedule over its DisTubeVoice: current, upcoming, bounded history, repeat and autoplay. Only the
 * queue starts tracks, so it owns pause, resume and seek of its current item.
 *
 * Schedule edits commit before they return and throw instead of rejecting. A queue is deleted on stop, exhaustion,
 * voice loss, leave or shutdown; a deleted queue rejects every command except `stop` with `INVALID_STATE`.
 */
export class DisTubeQueue<Metadata = unknown, Target = VoiceChannelTarget> {
  readonly guildId: string;
  readonly #guild: Guild<Target>;
  readonly #lifetime = new AbortController();
  #state: QueueState = IDLE_QUEUE_STATE;
  #tail: Promise<unknown> = Promise.resolve();
  #pending = 0;
  #inserted = false;
  #attempt?: Attempt;
  #loop: Promise<void> = Promise.resolve();
  #running = false;
  #lookup?: AbortController;
  #lastPlayed?: QueueItem;
  #autoplayItem?: string;
  #autoplayFailed = false;

  /** @internal */
  constructor(guild: Guild<Target>) {
    this.guildId = guild.id;
    this.#guild = guild;
    guild.config.events.emit("queue.created", this.#event());
  }

  /** Undefined until the first commit and after deletion, so a held queue never reaches a voice another queue now uses. */
  get voice(): DisTubeVoice<Target> | undefined {
    return this.#inserted && !this.#lifetime.signal.aborted ? this.#guild.voice : undefined;
  }

  get current(): QueueItem<Metadata> | undefined {
    return this.#state.current as QueueItem<Metadata> | undefined;
  }

  get upcoming(): readonly QueueItem<Metadata>[] {
    return this.#state.upcoming as readonly QueueItem<Metadata>[];
  }

  /** Recently ended occurrences, newest last, bounded by `DisTubeOptions.historySize`. */
  get history(): readonly QueueItem<Metadata>[] {
    return this.#state.history as readonly QueueItem<Metadata>[];
  }

  get status(): QueueStatus {
    return this.#snapshot().status;
  }

  /** Whether the current item is paused; every item starts unpaused. */
  get paused(): boolean {
    return this.#started() && this.#guild.paused;
  }

  get repeat(): RepeatMode {
    return this.#state.repeat;
  }

  get autoplay(): boolean {
    return this.#state.autoplay;
  }

  /** Elapsed seconds of the current item; `0` without a started one. */
  get position(): number {
    return this.#started() ? this.#guild.position : 0;
  }

  /** Resolves `input` and commits it in call order. Rejects `INVALID_STATE` if the guild has no voice by then. */
  add(input: ResolvableInput, options: AddOptions<Metadata> = {}): Promise<readonly QueueItem<Metadata>[]> {
    try {
      validateAdd(this.#guild.config.plugins, input, options);
      this.#assertCurrent();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return this.#enqueue(input, options) as Promise<readonly QueueItem<Metadata>[]>;
  }

  /** Removes waiting occurrences and returns them in order. */
  remove(target: RemoveTarget): readonly QueueItem<Metadata>[] {
    if (target === null || !["string", "number", "object"].includes(typeof target))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Remove target must be an occurrence ID, position or range");
    const removal =
      typeof target === "string"
        ? removeItem(this.#state, target)
        : typeof target === "number"
          ? removeRange(this.#state, target - 1, target - 1)
          : removeRange(this.#state, target.from - 1, target.to - 1);
    this.#assertAlive();
    this.#edit(removal.state);
    return removal.items as readonly QueueItem<Metadata>[];
  }

  /** Moves a waiting occurrence before another one, or to the tail. */
  move(itemId: string, beforeItemId?: string): void {
    const moved = moveBefore(this.#state, itemId, beforeItemId);
    this.#assertAlive();
    this.#edit(moved);
  }

  shuffle(): void {
    this.#assertAlive();
    this.#edit(shuffle(this.#state));
  }

  /** Removes every waiting item without ending the current one and returns them in order. */
  clear(): readonly QueueItem<Metadata>[] {
    this.#assertAlive();
    const removal = clearUpcoming(this.#state);
    this.#edit(removal.state);
    return removal.items as readonly QueueItem<Metadata>[];
  }

  setRepeat(mode: RepeatMode): void {
    if (!REPEAT_MODES.includes(mode))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Unknown repeat mode: ${String(mode)}`);
    this.#assertAlive();
    if (this.#state.repeat !== mode) this.#state = Object.freeze({ ...this.#state, repeat: mode });
  }

  setAutoplay(enabled: boolean): void {
    requireBoolean(enabled, "autoplay");
    this.#assertAlive();
    if (this.#state.autoplay !== enabled) this.#state = Object.freeze({ ...this.#state, autoplay: enabled });
    if (!enabled) this.#lookup?.abort();
  }

  /** Commits once the Player acknowledges; idempotent. */
  async pause(): Promise<void> {
    await this.#setPaused(true);
  }

  /** Commits once the Player acknowledges; idempotent. */
  async resume(): Promise<void> {
    await this.#setPaused(false);
  }

  /**
   * Seeks the current item within a known duration. Rejects `UNSUPPORTED` for a `url` or `stream` resource or an
   * engine that cannot seek, and `INVALID_STATE` when the item ends before the seek lands.
   */
  async seek(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Seek seconds must be non-negative");
    const duration = this.#state.current?.song.duration;
    if (duration && seconds > duration)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Seek seconds exceed the track duration");
    this.#assertStarted();
    await this.#guild.seek(seconds);
  }

  /** Ends the current item, or drops the one being prepared, and plays the next. */
  async skip(): Promise<void> {
    this.#assertAlive();
    const attempt = this.#attempt;
    if (!attempt) throw new DisTubeError(ErrorCode.INVALID_STATE, "Queue has nothing playing");
    if (attempt.playing) this.#end(attempt.item, false);
    else this.#state = failFirst(this.#state, attempt.item.id);
    await this.#interrupt(attempt);
  }

  /** Ends the current item and starts the waiting occurrence named by ID or one-based position. */
  async jump(target: string | number, options: JumpOptions = {}): Promise<void> {
    if (typeof target === "number" ? !Number.isInteger(target) || target < 1 : !target)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Jump target must be an occurrence ID or a positive integer");
    this.#assertAlive();
    const index = typeof target === "string" ? this.#state.upcoming.findIndex(item => item.id === target) : target - 1;
    const jumped = jumpTo(this.#state, index, options.requeue === true);
    const attempt = this.#attempt;
    if (attempt?.playing) this.#lastPlayed = attempt.item;
    this.#state = jumped.state;
    if (!options.requeue) for (const item of jumped.skipped) this.#remember(item);
    if (attempt && (attempt.playing || this.#state.upcoming[0] !== attempt.item)) await this.#interrupt(attempt);
  }

  /** Replays the most recent history Song as a new occurrence; the current item returns to the front. */
  async previous(): Promise<void> {
    this.#assertAlive();
    const popped = popHistory(this.#state);
    if (!popped) throw new DisTubeError(ErrorCode.INVALID_STATE, "Queue has no history to return to");
    const attempt = this.#attempt;
    const replay = queueItem(popped.item.song, popped.item.metadata, popped.item.autoplay);
    const current = attempt?.playing ? [attempt.item] : [];
    this.#state = insertAt(finishCurrent(popped.state), [replay, ...current], 0);
    if (attempt) await this.#interrupt(attempt);
    else this.#kick();
  }

  /**
   * Deletes the queue and keeps the voice with its settings. While the first join is pending it leaves instead.
   * Repeated calls, also on a deleted queue, share one completion.
   */
  stop(): Promise<void> {
    if (this.#lifetime.signal.aborted || this.#guild.voice || !this.#guild.joining) return this.delete("stop");
    this.#loop = this.#guild.leave();
    return this.#loop;
  }

  /** @internal */
  admit(input: ResolvableInput, options: AddOptions, join: () => Promise<unknown>): Promise<readonly QueueItem[]> {
    return this.#enqueue(input, options, join);
  }

  /** @internal */
  delete(reason: QueueDeleteReason, error?: DisTubeError): Promise<void> {
    if (this.#lifetime.signal.aborted) return this.#loop;
    this.#lifetime.abort();
    const attempt = this.#attempt;
    if (error && attempt?.playing) this.#emit("queue.item.failed", { item: attempt.item, error });
    this.#state = IDLE_QUEUE_STATE;
    this.#guild.unregister(this as DisTubeQueue<unknown, Target>);
    this.#emit("queue.deleted", { reason });
    return this.#loop;
  }

  #enqueue(input: ResolvableInput, options: AddOptions, join?: () => Promise<unknown>): Promise<readonly QueueItem[]> {
    this.#pending += 1;
    const { plugins, maxPlaylistSongs } = this.#guild.config;
    const signal = options.signal ? AbortSignal.any([this.#lifetime.signal, options.signal]) : this.#lifetime.signal;
    const step = this.#tail.then(async () => {
      this.#assertCurrent(options.signal);
      const media = await this.#recheck(resolveInput(plugins, input, signal, maxPlaylistSongs), options.signal, signal);
      if (join) await this.#recheck(join(), options.signal);
      else if (!this.#guild.voice)
        throw new DisTubeError(ErrorCode.INVALID_STATE, "The guild has no voice to add to; use distube.play");
      return this.#commit(media, options);
    });
    this.#tail = step.catch(() => undefined);
    this.#guild.guilds.track(this.#tail);
    return step.finally(() => this.#settled());
  }

  async #recheck<Value>(
    work: Promise<Value>,
    signal: AbortSignal | undefined,
    operation?: AbortSignal,
  ): Promise<Value> {
    let value: Value;
    try {
      value = await work;
    } catch (error: unknown) {
      this.#assertCurrent(signal, operation?.aborted ? undefined : error);
      throw error;
    }
    this.#assertCurrent(signal);
    return value;
  }

  #settled(): void {
    this.#pending -= 1;
    if (this.#pending > 0 || this.#running || this.#lifetime.signal.aborted) return;
    if (this.#inserted) this.#kick();
    else void this.delete("failed");
  }

  #commit(media: Song | Playlist, options: AddOptions): readonly QueueItem[] {
    const items = songsOf(media).map(song => queueItem(song, options.metadata));
    this.#edit(insertAt(this.#state, items, options.next ? 0 : options.at));
    this.#inserted = true;
    this.#autoplayFailed = false;
    this.#lookup?.abort();
    if (media instanceof Playlist) this.#emit("queue.playlist.added", { playlist: media, items });
    else for (const item of items) this.#emit("queue.item.added", { item });
    this.#kick();
    return items;
  }

  #kick(): void {
    if (this.#running || this.#lifetime.signal.aborted) return;
    this.#running = true;
    this.#loop = this.#run().catch((error: unknown) => this.#report("queue.loop", error));
  }

  async #run(): Promise<void> {
    try {
      while (!this.#lifetime.signal.aborted) {
        const item = this.#state.upcoming[0];
        if (item) {
          await this.#play(item);
          continue;
        }
        if (this.#pending > 0) return;
        if (await this.#autoplay()) continue;
        if (this.#pending > 0 || this.#lifetime.signal.aborted) return;
        this.#emit("queue.finished", {});
        void this.delete("finished");
      }
    } finally {
      this.#running = false;
    }
  }

  async #play(item: QueueItem): Promise<void> {
    const { plugins, engine } = this.#guild.config;
    const controller = new AbortController();
    const done = Promise.withResolvers<void>();
    const attempt: Attempt = { item, controller, done: done.promise, playing: false };
    const signal = AbortSignal.any([this.#lifetime.signal, controller.signal]);
    this.#attempt = attempt;
    try {
      let prepared;
      try {
        prepared = await prepareSong(plugins, engine, item.song, signal);
      } catch (error: unknown) {
        if (signal.aborted) return;
        this.#state = failFirst(this.#state, item.id);
        this.#autoplayFailed ||= item.id === this.#autoplayItem;
        this.#emit("queue.item.failed", {
          item,
          error: toDisTubeError(ErrorCode.SOURCE_FAILED, "Failed to prepare the QueueItem", error),
        });
        return;
      }
      const started = startFirst(this.#state);
      if (signal.aborted || started?.item !== item || !this.voice) {
        const voiceLost = !this.voice && !signal.aborted;
        await disposeResource(prepared.resource).catch((error: unknown) =>
          this.#report("queue.resource.dispose", error),
        );
        if (voiceLost) void this.delete("voice-loss");
        return;
      }
      this.#state = started.state;
      attempt.playing = true;
      let end: TrackEnd;
      try {
        const { resource, fallback } = prepared;
        end = await this.#guild.playTrack(resource, signal, () =>
          this.#emit("queue.item.started", fallback ? { item, fallback } : { item }),
        );
      } catch (error: unknown) {
        if (signal.aborted) return;
        this.#state = finishCurrent(this.#state);
        this.#autoplayFailed ||= item.id === this.#autoplayItem;
        this.#emit("queue.item.failed", {
          item,
          error: toDisTubeError(ErrorCode.VOICE_FAILED, "Failed to play the QueueItem", error),
        });
        return;
      }
      if (!signal.aborted) this.#end(item, end.reason === "finished");
    } finally {
      this.#attempt = undefined;
      done.resolve();
    }
  }

  #end(item: QueueItem, finished: boolean): void {
    this.#lastPlayed = item;
    this.#state = finishCurrent(this.#state);
    if (finished && this.#state.repeat !== "off") {
      const replay = queueItem(item.song, item.metadata, item.autoplay);
      this.#state = insertAt(this.#state, [replay], this.#state.repeat === "song" ? 0 : undefined);
    }
    if (finished) this.#emit("queue.item.finished", { item });
    this.#remember(item);
  }

  async #autoplay(): Promise<boolean> {
    const seed = this.#lastPlayed;
    if (!this.#state.autoplay || !seed || this.#autoplayFailed) return false;
    const lookup = new AbortController();
    this.#lookup = lookup;
    let song: Song | undefined;
    let failure: unknown;
    try {
      const signal = AbortSignal.any([this.#lifetime.signal, lookup.signal]);
      const exclude = this.#state.history.map(entry => entry.song);
      song = await untilAborted(relatedSong(this.#guild.config.plugins, seed.song, exclude, signal), signal);
    } catch (error: unknown) {
      failure = error;
    } finally {
      this.#lookup = undefined;
    }
    if (this.#lifetime.signal.aborted) return false;
    if (this.#state.upcoming.length > 0) return true;
    if (lookup.signal.aborted) return false;
    if (!song) {
      const error =
        failure === undefined
          ? new DisTubeError(ErrorCode.SOURCE_FAILED, "Autoplay found no related Song")
          : toDisTubeError(ErrorCode.SOURCE_FAILED, "Autoplay failed", failure);
      this.#emit("queue.autoplay.failed", { song: seed.song, error });
      return false;
    }
    const item = queueItem(song, seed.metadata, true);
    this.#autoplayItem = item.id;
    this.#state = insertAt(this.#state, [item]);
    this.#emit("queue.item.added", { item });
    return true;
  }

  #setPaused(paused: boolean): Promise<void> {
    this.#assertStarted();
    return this.#guild.setPaused(paused);
  }

  #started(): boolean {
    return !this.#lifetime.signal.aborted && this.#attempt?.playing === true;
  }

  #interrupt(attempt: Attempt): Promise<void> {
    attempt.controller.abort();
    return attempt.done;
  }

  #edit(state: QueueState): void {
    this.#state = state;
    const attempt = this.#attempt;
    if (attempt && !attempt.playing && state.upcoming[0] !== attempt.item) attempt.controller.abort();
  }

  #snapshot(): QueueState {
    const state = this.#state;
    return state.status === "playing" && this.paused ? Object.freeze({ ...state, status: "paused" }) : state;
  }

  #remember(item: QueueItem): void {
    this.#state = pushHistory(this.#state, item, this.#guild.config.historySize);
  }

  #assertAlive(): void {
    if (this.#lifetime.signal.aborted) throw new DisTubeError(ErrorCode.INVALID_STATE, "DisTubeQueue is deleted");
  }

  #assertStarted(): void {
    this.#assertAlive();
    if (!this.#started() || !this.voice)
      throw new DisTubeError(ErrorCode.INVALID_STATE, "Queue has no started QueueItem");
  }

  /** A step that outlived the client or the queue rejects `INVALID_STATE` with `cause`, a failure that was not cancelled. */
  #assertCurrent(signal?: AbortSignal, cause?: unknown): void {
    const ended = this.#guild.config.lifetime.aborted
      ? "DisTube is disposed"
      : this.#lifetime.signal.aborted
        ? "Queue was deleted before the insertion"
        : undefined;
    if (ended) throw new DisTubeError(ErrorCode.INVALID_STATE, ended, cause === undefined ? undefined : { cause });
    throwIfAborted(signal);
  }

  #event(): BaseQueueEvent<unknown, Target> {
    return {
      guildId: this.guildId,
      queue: this as DisTubeQueue<unknown, Target>,
      state: this.#snapshot(),
      timestamp: Date.now(),
    };
  }

  #emit<Name extends QueueEventName>(
    name: Name,
    detail: Omit<DisTubeEventMap<unknown, Target>[Name], keyof BaseQueueEvent>,
  ): void {
    this.#guild.config.events.emit(name, { ...this.#event(), ...detail } as DisTubeEventMap<unknown, Target>[Name]);
  }

  #report(stage: string, error: unknown): void {
    this.#guild.config.events.report({
      severity: "error",
      stage,
      message: `DisTubeQueue ${this.guildId}: ${stage}`,
      error,
    });
  }
}

function untilAborted<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(abortError(signal));
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function validateAdd(plugins: readonly Plugin[], input: ResolvableInput, options: AddOptions): void {
  validateInput(plugins, input);
  if (options.at !== undefined) requireInteger(options.at, "at", 0);
  if (options.next !== undefined) requireBoolean(options.next, "next");
  if (options.at !== undefined && options.next !== undefined)
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "next and at are mutually exclusive");
  throwIfAborted(options.signal);
}
