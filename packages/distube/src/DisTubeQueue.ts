import type { Engine, Plugin, ResolvableInput, TrackEnd } from "./contracts";
import { QueueStatus, RepeatMode } from "./enums";
import { abortError, DisTubeError, ErrorCode, requireBoolean, toDisTubeError } from "./errors";
import type { BaseQueueEvent, DisTubeEventMap, DisTubeEvents, QueueDeleteReason } from "./events";
import { Playlist, QueueItem, type Song } from "./media";
import { disposeResource, prepareSong, relatedSong, songsOf } from "./plugins";
import {
  clearQueue,
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
  removeItem,
  removeRange,
  setAutoplay,
  setRepeat,
  shuffle,
  startFirst,
} from "./queue/state";
import type { DisTubeVoice } from "./voice/DisTubeVoice";
import type { VoiceChannelTarget } from "./voice/target";

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

export interface QueueContext<Target> {
  readonly guildId: string;
  readonly historySize: number;
  readonly plugins: readonly Plugin[];
  readonly engine: Engine;
  readonly events: DisTubeEvents<Target>;
  readonly voice: () => DisTubeVoice<Target> | undefined;
  readonly add: (input: ResolvableInput, options: AddOptions) => Promise<readonly QueueItem[]>;
  readonly unregister: () => void;
}

export interface QueueControl {
  reserve<Metadata, Target>(queue: DisTubeQueue<Metadata, Target>): () => void;
  insert<Metadata, Target>(
    queue: DisTubeQueue<Metadata, Target>,
    media: Song | Playlist,
    options: AddOptions,
  ): readonly QueueItem[];
  delete<Metadata, Target>(
    queue: DisTubeQueue<Metadata, Target>,
    reason: QueueDeleteReason,
    error?: DisTubeError,
  ): Promise<void>;
  signal<Metadata, Target>(queue: DisTubeQueue<Metadata, Target>): AbortSignal;
}

interface Attempt {
  readonly item: QueueItem;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  playing: boolean;
}

type QueueEventName = Exclude<keyof DisTubeEventMap, "queue.created" | "voice.disconnected">;

export let queueControl: QueueControl;

/**
 * One guild's schedule over its DisTubeVoice: current, upcoming, bounded history, repeat and autoplay.
 *
 * Edits commit synchronously before their promise settles. A queue is deleted on stop, exhaustion, voice loss, leave, shutdown, or when
 * a direct `voice.play` replaces its track; a deleted queue rejects every command with `INVALID_STATE`.
 */
export class DisTubeQueue<Metadata = unknown, Target = VoiceChannelTarget> {
  readonly guildId: string;
  readonly #context: QueueContext<Target>;
  readonly #lifetime = new AbortController();
  #state: QueueState = IDLE_QUEUE_STATE;
  #attempt?: Attempt;
  #loop: Promise<void> = Promise.resolve();
  #running = false;
  #pending = 0;
  #inserted = false;
  #lastPlayed?: Song;
  #lookup?: AbortController;

  static {
    queueControl = {
      reserve: queue => queue.#reserve(),
      insert: (queue, media, options) => queue.#insert(media, options),
      delete: (queue, reason, error) => queue.#delete(reason, error),
      signal: queue => queue.#lifetime.signal,
    };
  }

  constructor(context: QueueContext<Target>) {
    this.guildId = context.guildId;
    this.#context = context;
    context.events.emit("queue.created", this.#event());
  }

  /** Undefined until the first insertion commits and after deletion. */
  get voice(): DisTubeVoice<Target> | undefined {
    return this.#inserted && !this.#lifetime.signal.aborted ? this.#context.voice() : undefined;
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

  /** Follows the voice's paused state, including a pause or resume called on the voice directly. */
  get status(): QueueStatus {
    return this.#snapshot().status;
  }

  get repeat(): RepeatMode {
    return this.#state.repeat;
  }

  get autoplay(): boolean {
    return this.#state.autoplay;
  }

  /** Elapsed seconds of the current item; `0` without one. */
  get position(): number {
    return this.#attempt?.playing ? (this.voice?.position ?? 0) : 0;
  }

  add(input: ResolvableInput, options: AddOptions<Metadata> = {}): Promise<readonly QueueItem<Metadata>[]> {
    return this.#context.add(input, options) as Promise<readonly QueueItem<Metadata>[]>;
  }

  /** Removes waiting occurrences and resolves with them. Commits synchronously. */
  async remove(target: RemoveTarget): Promise<readonly QueueItem<Metadata>[]> {
    this.#assertAlive();
    const removal =
      typeof target === "string"
        ? removeItem(this.#state, target)
        : typeof target === "number"
          ? removeRange(this.#state, target - 1, target - 1)
          : removeRange(this.#state, target.from - 1, target.to - 1);
    this.#edit(removal.state);
    return removal.items as readonly QueueItem<Metadata>[];
  }

  /** Moves a waiting occurrence before another one, or to the tail. Commits synchronously. */
  async move(itemId: string, beforeItemId?: string): Promise<void> {
    this.#assertAlive();
    this.#edit(moveBefore(this.#state, itemId, beforeItemId));
  }

  async shuffle(): Promise<void> {
    this.#assertAlive();
    this.#edit(shuffle(this.#state));
  }

  /** Removes every waiting item without ending the current one. Commits synchronously. */
  async clear(): Promise<void> {
    this.#assertAlive();
    this.#edit(clearUpcoming(this.#state).state);
  }

  async setRepeat(mode: RepeatMode): Promise<void> {
    this.#assertAlive();
    if (!Object.values(RepeatMode).includes(mode))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Unknown repeat mode: ${String(mode)}`);
    this.#state = setRepeat(this.#state, mode);
  }

  async setAutoplay(enabled: boolean): Promise<void> {
    this.#assertAlive();
    requireBoolean(enabled, "autoplay");
    this.#state = setAutoplay(this.#state, enabled);
    if (!enabled) this.#lookup?.abort();
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
    this.#assertAlive();
    if (typeof target === "number" ? !Number.isInteger(target) || target < 1 : !target)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Jump target must be an occurrence ID or a positive integer");
    const index = typeof target === "string" ? this.#state.upcoming.findIndex(item => item.id === target) : target - 1;
    if (index < 0 || index >= this.#state.upcoming.length)
      throw new DisTubeError(ErrorCode.INVALID_STATE, "Jump target is not upcoming in this queue");
    const attempt = this.#attempt;
    if (attempt?.playing) this.#lastPlayed = attempt.item.song;
    const jumped = jumpTo(this.#state, index, options.requeue === true);
    this.#state = jumped.state;
    if (!options.requeue) for (const item of jumped.skipped) this.#remember(item);
    if (attempt && (attempt.playing || this.#state.upcoming[0] !== attempt.item)) await this.#interrupt(attempt);
    else this.#kick();
  }

  /** Replays the most recent history Song as a new occurrence; the current item returns to the front. */
  async previous(): Promise<void> {
    this.#assertAlive();
    const popped = popHistory(this.#state);
    if (!popped) throw new DisTubeError(ErrorCode.INVALID_STATE, "Queue has no history to return to");
    const attempt = this.#attempt;
    const replay = new QueueItem({ song: popped.item.song, metadata: popped.item.metadata });
    const current = attempt?.playing ? [attempt.item] : [];
    this.#state = insertAt(finishCurrent(popped.state), [replay, ...current], 0);
    if (attempt) await this.#interrupt(attempt);
    else this.#kick();
  }

  async pause(): Promise<void> {
    await this.#control(voice => voice.pause());
  }

  async resume(): Promise<void> {
    await this.#control(voice => voice.resume());
  }

  async seek(seconds: number): Promise<void> {
    const duration = this.#state.current?.song.duration;
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Seek seconds must be non-negative");
    if (duration && seconds > duration)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Seek seconds exceed the track duration");
    await this.#control(voice => voice.seek(seconds));
  }

  /** Appends one related occurrence for the current or most recent Song. */
  async addRelated(): Promise<QueueItem<Metadata>> {
    this.#assertAlive();
    const seed = this.#state.current?.song ?? this.#lastPlayed;
    if (!seed) throw new DisTubeError(ErrorCode.INVALID_STATE, "Queue has no Song to find related media for");
    const song = await relatedSong(this.#context.plugins, seed, this.#historySongs(), this.#lifetime.signal);
    if (!song) throw new DisTubeError(ErrorCode.SOURCE_FAILED, "No related Song was found");
    const [item] = await this.add(song);
    return item as QueueItem<Metadata>;
  }

  /** Ends playback and deletes the queue, leaving the voice connected with its settings. Repeated calls share one completion. */
  stop(): Promise<void> {
    return this.#delete("stop");
  }

  #reserve(): () => void {
    this.#assertAlive();
    this.#pending += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#pending -= 1;
      if (this.#pending > 0 || this.#running || this.#lifetime.signal.aborted) return;
      if (this.#inserted) this.#kick();
      else void this.#delete("failed");
    };
  }

  #insert(media: Song | Playlist, options: AddOptions): readonly QueueItem[] {
    this.#assertAlive();
    const items = songsOf(media).map(song => new QueueItem({ song, metadata: options.metadata }));
    this.#edit(insertAt(this.#state, items, options.next ? 0 : options.at));
    this.#inserted = true;
    this.#lookup?.abort();
    if (media instanceof Playlist) this.#emit("queue.playlist.added", { playlist: media, items });
    else for (const item of items) this.#emit("queue.item.added", { item });
    this.#kick();
    return items;
  }

  #delete(reason: QueueDeleteReason, error?: DisTubeError): Promise<void> {
    if (this.#lifetime.signal.aborted) return this.#loop;
    this.#lifetime.abort();
    const attempt = this.#attempt;
    if (error && attempt?.playing) this.#emit("queue.item.failed", { item: attempt.item, error });
    this.#state = clearQueue(this.#state);
    this.#context.unregister();
    this.#emit("queue.deleted", { reason });
    return this.#loop;
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
        void this.#delete("finished");
      }
    } finally {
      this.#running = false;
    }
  }

  async #play(item: QueueItem): Promise<void> {
    let finish!: () => void;
    const controller = new AbortController();
    const attempt: Attempt = { item, controller, done: new Promise(resolve => (finish = resolve)), playing: false };
    const signal = AbortSignal.any([this.#lifetime.signal, controller.signal]);
    this.#attempt = attempt;
    try {
      let resource;
      try {
        resource = await prepareSong(this.#context.plugins, this.#context.engine, item.song, signal);
      } catch (error: unknown) {
        if (signal.aborted) return;
        this.#state = failFirst(this.#state, item.id);
        this.#emit("queue.item.failed", {
          item,
          error: toDisTubeError(ErrorCode.SOURCE_FAILED, "Failed to prepare the QueueItem", error),
        });
        return;
      }
      const voice = this.voice;
      const started = startFirst(this.#state);
      if (signal.aborted || started?.item !== item || !voice) {
        await disposeResource(resource).catch((error: unknown) => this.#report("queue.resource.dispose", error));
        if (!voice && !signal.aborted) void this.#delete("voice-loss");
        return;
      }
      this.#state = started.state;
      attempt.playing = true;
      let end: TrackEnd;
      try {
        end = await voice.play(resource, { signal, onStart: () => this.#emit("queue.item.started", { item }) });
      } catch (error: unknown) {
        if (signal.aborted) return;
        this.#state = finishCurrent(this.#state);
        this.#emit("queue.item.failed", {
          item,
          error: toDisTubeError(ErrorCode.VOICE_FAILED, "Failed to play the QueueItem", error),
        });
        return;
      }
      if (signal.aborted) return;
      if (end.reason === "replaced") void this.#delete("replaced");
      else this.#end(item, end.reason === "finished");
    } finally {
      this.#attempt = undefined;
      finish();
    }
  }

  #end(item: QueueItem, finished: boolean): void {
    this.#lastPlayed = item.song;
    this.#state = finishCurrent(this.#state);
    if (finished && this.#state.repeat !== RepeatMode.Off) {
      const replay = new QueueItem({ song: item.song, metadata: item.metadata });
      this.#state = insertAt(this.#state, [replay], this.#state.repeat === RepeatMode.Song ? 0 : undefined);
    }
    if (finished) this.#emit("queue.item.finished", { item });
    this.#remember(item);
  }

  async #autoplay(): Promise<boolean> {
    const seed = this.#lastPlayed;
    if (!this.#state.autoplay || !seed) return false;
    const lookup = new AbortController();
    this.#lookup = lookup;
    let song: Song | undefined;
    let failure: unknown;
    try {
      const signal = AbortSignal.any([this.#lifetime.signal, lookup.signal]);
      song = await untilAborted(relatedSong(this.#context.plugins, seed, this.#historySongs(), signal), signal);
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
      this.#emit("queue.autoplay.failed", { song: seed, error });
      return false;
    }
    const item = new QueueItem({ song });
    this.#state = insertAt(this.#state, [item]);
    this.#emit("queue.item.added", { item });
    return true;
  }

  #interrupt(attempt: Attempt): Promise<void> {
    attempt.controller.abort();
    return attempt.done;
  }

  async #control(apply: (voice: DisTubeVoice<Target>) => Promise<void>): Promise<void> {
    this.#assertAlive();
    const voice = this.voice;
    if (!this.#attempt?.playing || !voice)
      throw new DisTubeError(ErrorCode.INVALID_STATE, "Queue has no current QueueItem");
    await apply(voice);
  }

  #edit(state: QueueState): void {
    this.#state = state;
    const attempt = this.#attempt;
    if (attempt && !attempt.playing && state.upcoming[0] !== attempt.item) attempt.controller.abort();
  }

  #snapshot(): QueueState {
    const state = this.#state;
    return state.status === QueueStatus.Playing && this.voice?.paused
      ? Object.freeze({ ...state, status: QueueStatus.Paused })
      : state;
  }

  #remember(item: QueueItem): void {
    if (this.#context.historySize <= 0) return;
    this.#state = pushHistory(this.#state, item, this.#context.historySize);
    this.#emit("queue.history.added", { item });
  }

  #historySongs(): readonly Song[] {
    return this.#state.history.map(item => item.song);
  }

  #assertAlive(): void {
    if (this.#lifetime.signal.aborted) throw new DisTubeError(ErrorCode.INVALID_STATE, "DisTubeQueue is deleted");
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
    this.#context.events.emit(name, { ...this.#event(), ...detail } as DisTubeEventMap<unknown, Target>[Name]);
  }

  #report(stage: string, error: unknown): void {
    this.#context.events.report({ severity: "error", stage, message: `DisTubeQueue ${this.guildId}: ${stage}`, error });
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
