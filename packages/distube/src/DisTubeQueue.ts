import type { ResolvableInput } from "./contracts";
import { QueueStatus, RepeatMode } from "./enums";
import { asDisTubeError, DisTubeError, ErrorCode } from "./errors";
import type { BaseQueueEvent, DisTubeEventEmitter, DisTubeEventMap, DisTubeEventName } from "./events";
import { Playlist, QueueItem, type Song } from "./media";
import { preparePlaybackResource } from "./playback/prepare";
import { relatedSong } from "./playback/related";
import { type OwnedPlaybackResource, resourceErrorContext } from "./playback/resource";
import { type SourceCatalog, songsOf } from "./playback/sources";
import { asError, cleanupFailure } from "./queue/failures";
import { Mailbox } from "./queue/mailbox";
import type {
  ActivePlayback,
  AddOptions,
  AdvanceMode,
  JumpOptions,
  PlaybackAttempt,
  QueueEdit,
  QueueMessage,
  QueueSetting,
  RemoveTarget,
} from "./queue/protocol";
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
  setStatus,
  shuffle,
  startFirst,
} from "./queue/state";
import type { QueueTerminalCause } from "./queue/terminal";
import { TrackedWork } from "./utils/tracked-work";
import type { DisTubeVoice, TrackOutcome, TrackOwner, VoiceImpl } from "./voice/DisTubeVoice";

import type { VoiceChannelTarget } from "./voice/target";

/** The events a queue publishes itself; `queue.created` belongs to the registry that made it. */
type QueueOwnedEvent = Exclude<
  DisTubeEventName,
  "queue.created" | "voice.disconnected" | "voice.track.started" | "voice.track.finished" | "voice.track.failed"
>;

const NO_ITEMS: readonly QueueItem[] = Object.freeze([]);

/**
 * Public guild queue facade: a scheduler over the guild's DisTubeVoice.
 *
 * `Metadata` is the client's caller-metadata type, threaded so a read of `item.metadata` needs no cast.
 */
export type DisTubeQueue<Metadata = unknown, Target = VoiceChannelTarget> = {
  readonly guildId: string;
  readonly voice: DisTubeVoice<Target> | undefined;
  readonly current: QueueItem<Metadata> | undefined;
  readonly upcoming: readonly QueueItem<Metadata>[];
  /** Recently ended occurrences, newest last, bounded by `DisTubeOptions.historySize`. */
  readonly history: readonly QueueItem<Metadata>[];
  readonly status: QueueStatus;
  readonly repeat: RepeatMode;
  readonly autoplay: boolean;
  /** Elapsed seconds of the current item, read from the voice; `0` without one. */
  readonly position: number;
  add(input: ResolvableInput, options?: AddOptions<Metadata>): Promise<readonly QueueItem<Metadata>[]>;
  remove(target: RemoveTarget): Promise<readonly QueueItem<Metadata>[]>;
  move(itemId: string, beforeItemId?: string): Promise<void>;
  /** Ends the current item and starts the waiting occurrence named by ID or one-based position. */
  jump(target: string | number, options?: JumpOptions): Promise<void>;
  /** Replays the most recent history Song as a new occurrence; the current item returns to the front. */
  previous(): Promise<void>;
  shuffle(): Promise<void>;
  /** Removes every waiting item without ending the current one. */
  clear(): Promise<void>;
  skip(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(seconds: number): Promise<void>;
  /** Ends playback and deletes the queue, leaving the voice connected with its settings. */
  stop(): Promise<void>;
  /** Appends one related occurrence for the current or most recent Song. */
  addRelated(): Promise<QueueItem<Metadata>>;
  setRepeat(mode: RepeatMode): Promise<void>;
  setAutoplay(enabled: boolean): Promise<void>;
};

/** Package-private implementation of the DisTubeQueue facade. */
export class QueueImpl<Target = VoiceChannelTarget> implements TrackOwner {
  readonly #facade: DisTubeQueue<unknown, Target>;
  readonly #queueId: string;
  readonly guildId: string;
  readonly #sources: SourceCatalog;
  readonly #events: DisTubeEventEmitter<Target>;
  readonly #historySize: number;
  /** Frees the guild and hands the registry this deletion's completion so shutdown can join it. */
  readonly #unregister: (completion: Promise<void>) => void;
  readonly #mailbox: Mailbox<QueueMessage>;
  readonly #work = new TrackedWork();
  readonly #preAcceptanceCleanups = new WeakMap<PlaybackAttempt, Promise<void>>();
  #voice?: VoiceImpl<Target>;
  #state: QueueState = IDLE_QUEUE_STATE;
  #attempt?: PlaybackAttempt;
  /** The voice can report a track's outcome before its activation commits in the mailbox. */
  #activatingOutcome?: TrackOutcome;
  #active?: ActivePlayback;
  /** The autoplay seed: the last naturally finished or skipped Song, kept even with a zero history. */
  #lastPlayed?: Song;
  #autoplayLookup?: AbortController;
  #exhausted = false;
  #destroyRequested = false;
  #published = false;
  #reservations = 0;
  #inserted = false;
  readonly #reservationController = new AbortController();
  #destroyEventEmitted = false;
  #terminalPromise?: Promise<void>;

  /** @internal */
  constructor(
    binding: { readonly queueId: string; readonly guildId: string; readonly historySize: number },
    sources: SourceCatalog,
    events: DisTubeEventEmitter<Target>,
    unregister: (completion: Promise<void>) => void = () => undefined,
    add: (input: ResolvableInput, options?: AddOptions) => Promise<readonly QueueItem[]> = () =>
      Promise.reject(new DisTubeError("INVALID_STATE", "Queue is not registered")),
    stop: () => Promise<void> = () => this.destroy(),
  ) {
    this.#queueId = binding.queueId;
    this.guildId = binding.guildId;
    this.#historySize = binding.historySize;
    this.#sources = sources;
    this.#events = events;
    this.#unregister = unregister;
    this.#mailbox = new Mailbox(message => this.#handle(message));
    const self = this;
    const facade: DisTubeQueue<unknown, Target> = {
      get guildId(): string {
        return self.guildId;
      },
      get voice(): DisTubeVoice<Target> | undefined {
        return self.#voice?.facade;
      },
      get current(): QueueItem | undefined {
        return self.#state.current;
      },
      get upcoming(): readonly QueueItem[] {
        return self.#state.upcoming;
      },
      get history(): readonly QueueItem[] {
        return self.#state.history;
      },
      get status(): QueueStatus {
        return self.#state.status;
      },
      get repeat(): RepeatMode {
        return self.#state.repeat;
      },
      get autoplay(): boolean {
        return self.#state.autoplay;
      },
      get position(): number {
        return self.position;
      },
      add,
      remove: target => self.remove(target),
      move: (itemId, beforeItemId) => self.move(itemId, beforeItemId),
      jump: (target, options) => self.jump(target, options),
      previous: () => self.previous(),
      shuffle: () => self.#edit({ kind: "shuffle" }).then(() => undefined),
      clear: () => self.#edit({ kind: "clear" }).then(() => undefined),
      skip: () => self.skip(),
      pause: () => self.pause(),
      resume: () => self.resume(),
      seek: seconds => self.seek(seconds),
      stop,
      addRelated: () => self.addRelated(),
      setRepeat: mode => self.setRepeat(mode),
      setAutoplay: enabled => self.setAutoplay(enabled),
    };
    Object.freeze(facade);
    this.#facade = facade;
  }

  /** Package-private public view; the implementation never crosses the package boundary. */
  get facade(): DisTubeQueue<unknown, Target> {
    return this.#facade;
  }

  /** Attaches this queue to the guild's live voice so its track controls answer only to this queue. */
  onTrackStarted(itemId: string): void {
    const attempt = this.#attempt;
    if (attempt?.item.id === itemId) this.#mailbox.post({ type: "play.completed", attempt });
  }

  attachVoice(voice: VoiceImpl<Target>): void {
    this.#assertActive();
    if (this.#voice === voice) return;
    if (this.#voice) throw new DisTubeError(ErrorCode.QUEUE_FAILED, "Queue cannot attach to a replacement voice");
    voice.attach(this);
    this.#voice = voice;
  }

  get state(): QueueState {
    return this.#state;
  }

  get empty(): boolean {
    return (
      this.#reservations === 0 &&
      !this.#active &&
      !this.#attempt &&
      !this.#state.current &&
      this.#state.upcoming.length === 0
    );
  }

  get terminal(): boolean {
    return this.#destroyRequested;
  }

  reserve(caller?: AbortSignal): { readonly signal: AbortSignal; readonly release: () => void } {
    this.#assertActive();
    this.#reservations += 1;
    this.#cancelAutoplay();
    let released = false;
    return {
      signal: caller
        ? AbortSignal.any([caller, this.#reservationController.signal])
        : this.#reservationController.signal,
      release: () => {
        if (released) return;
        released = true;
        this.#reservations -= 1;
        if (this.empty && this.#inserted && !this.#destroyRequested) this.#exhaust();
      },
    };
  }

  fenceReservations(): void {
    this.#reservationController.abort(this.#stale());
  }

  publishCreated(): void {
    if (this.#published) return;
    this.#published = true;
    this.#events.emit(
      "queue.created",
      Object.freeze({ guildId: this.guildId, queue: this.#facade, state: this.#state, timestamp: Date.now() }),
    );
  }

  get position(): number {
    return this.#active ? (this.#voice?.position ?? 0) : 0;
  }

  /** Voice track outcomes arrive here synchronously; the mailbox orders them with every other decision. */
  onTrackOutcome(outcome: TrackOutcome): void {
    this.#mailbox.post({ type: "track.outcome", outcome });
  }

  insert(media: Song | Playlist, options: AddOptions = {}): Promise<readonly QueueItem[]> {
    try {
      this.#assertActive();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => this.#mailbox.post({ type: "insert", media, options, resolve, reject }));
  }

  async move(itemId: string, beforeItemId?: string): Promise<void> {
    await this.#edit({ kind: "move", itemId, beforeItemId });
  }

  remove(target: RemoveTarget): Promise<readonly QueueItem[]> {
    try {
      validateRemoveTarget(target);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return this.#edit({ kind: "remove", target });
  }

  /** Ends the current occurrence and plays the next waiting one. */
  skip(): Promise<void> {
    return this.#advance({ kind: "skip" });
  }

  jump(target: string | number, options: JumpOptions = {}): Promise<void> {
    if (
      (typeof target !== "string" && typeof target !== "number") ||
      (typeof target === "string" && target.length === 0) ||
      (typeof target === "number" && (!Number.isInteger(target) || target < 1)) ||
      (options.requeue !== undefined && typeof options.requeue !== "boolean")
    ) {
      return Promise.reject(
        new DisTubeError("INVALID_ARGUMENT", "Jump target must be an occurrence ID or a positive position"),
      );
    }
    return this.#advance({ kind: "jump", target, requeue: options.requeue === true });
  }

  previous(): Promise<void> {
    return this.#advance({ kind: "previous" });
  }

  pause(): Promise<void> {
    return this.#control("pause");
  }

  resume(): Promise<void> {
    return this.#control("resume");
  }

  seek(seconds: number): Promise<void> {
    return this.#control("seek", seconds);
  }

  setRepeat(mode: RepeatMode): Promise<void> {
    if (!Object.values(RepeatMode).includes(mode))
      return Promise.reject(new DisTubeError("INVALID_ARGUMENT", `Unknown repeat mode: ${String(mode)}`));
    return this.#setting({ repeat: mode });
  }

  setAutoplay(enabled: boolean): Promise<void> {
    if (typeof enabled !== "boolean")
      return Promise.reject(new DisTubeError("INVALID_ARGUMENT", "autoplay must be a boolean"));
    return this.#setting({ autoplay: enabled });
  }

  /** Looks up one related Song for the reference Song and appends it through the ordered insert path. */
  async addRelated(): Promise<QueueItem> {
    this.#assertActive();
    const seed = this.#state.current?.song ?? this.#lastPlayed;
    if (!seed) throw new DisTubeError("INVALID_STATE", "Queue has no Song to find related media for");
    const reservation = this.reserve();
    try {
      const song = await this.#work.start(() =>
        relatedSong(
          seed,
          this.#sources,
          reservation.signal,
          this.#state.history.map(item => item.song),
        ),
      );
      if (!song) throw new DisTubeError(ErrorCode.SOURCE_FAILED, "Source found no related Song");
      const [item] = await this.insert(song);
      if (!item) throw this.#stale();
      return item;
    } catch (error: unknown) {
      if (this.#destroyRequested) throw this.#stale();
      throw asDisTubeError(ErrorCode.SOURCE_FAILED, "Source failed to find related media", error);
    } finally {
      reservation.release();
    }
  }

  /** The single terminal operation: ends playback and deletes the queue, leaving the voice connected. */
  stop(): Promise<void> {
    return this.destroy({ kind: "stop" });
  }

  /** @internal */
  destroy(cause: QueueTerminalCause = { kind: "stop" }): Promise<void> {
    if (this.#terminalPromise) return this.#terminalPromise;

    let resolveTerminal!: () => void;
    let rejectTerminal!: (error: unknown) => void;
    const terminal = new Promise<void>((resolve, reject) => {
      resolveTerminal = resolve;
      rejectTerminal = reject;
    });
    // Reentrant terminal callers must join before the first terminal event can invoke listeners.
    this.#terminalPromise = terminal;
    this.#destroyRequested = true;
    this.fenceReservations();
    this.#cancelAutoplay();
    const attempt = this.#attempt;
    attempt?.controller.abort(this.#stale());
    this.#attempt = undefined;
    this.#activatingOutcome = undefined;
    const active = this.#active;
    this.#active = undefined;
    this.#state = clearQueue(this.#state);
    this.#unregister(terminal);
    this.#mailbox.close();

    // The voice already published voice.track.failed for its track: the active item, or the one it was acknowledging.
    const lost = active?.item ?? (attempt?.phase === "activating" ? attempt.item : undefined);
    if (cause.kind === "voice-loss" && lost) {
      this.#emit(
        "queue.item.failed",
        { item: lost, error: asDisTubeError(ErrorCode.VOICE_FAILED, "Voice disconnected terminally", cause.error) },
        Date.now(),
      );
    }
    this.#emitDeletion();

    // Detaching in this stack frees the voice's track controls before any replacement can attach.
    const detached = this.#voice?.detach(this) ?? Promise.resolve();
    this.#voice = undefined;
    void this.#work.start(() => detached).catch(() => undefined);
    // Preparing resources still belong to the queue. Accepted and active tracks belong to the voice.
    if (attempt?.phase === "preparing" && attempt.resource && !this.#preAcceptanceCleanups.has(attempt)) {
      this.#scheduleTerminalDisposal(attempt.resource, detached);
    }

    void this.#work
      .settle()
      .then(failures => {
        const failure = cleanupFailure(
          ErrorCode.VOICE_FAILED,
          "Queue cleanup failed",
          failures,
          "Queue cleanup failures",
        );
        if (failure) throw failure;
      })
      .then(
        () => {
          resolveTerminal();
        },
        (error: unknown) => {
          rejectTerminal(error);
        },
      );
    return terminal;
  }

  #edit(edit: QueueEdit): Promise<readonly QueueItem[]> {
    try {
      this.#assertActive();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => this.#mailbox.post({ type: "edit", edit, resolve, reject }));
  }

  #advance(mode: AdvanceMode): Promise<void> {
    try {
      this.#assertActive();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => this.#mailbox.post({ type: "advance", mode, resolve, reject }));
  }

  #control(control: "pause" | "resume" | "seek", seconds?: number): Promise<void> {
    try {
      this.#assertActive();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) =>
      this.#mailbox.post({
        type: "control",
        control,
        ...(seconds === undefined ? {} : { seconds }),
        resolve,
        reject,
      }),
    );
  }

  #setting(setting: QueueSetting): Promise<void> {
    try {
      this.#assertActive();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => this.#mailbox.post({ type: "setting", setting, resolve, reject }));
  }

  #handle(message: QueueMessage): void | Promise<void> {
    switch (message.type) {
      case "insert":
        this.#insert(message);
        return;
      case "start":
        this.#startNext();
        return;
      case "preparation.completed":
        this.#completePreparation(message);
        return;
      case "play.completed":
        this.#completePlay(message);
        return;
      case "track.outcome":
        this.#completeOutcome(message.outcome);
        return;
      case "autoplay.completed":
        this.#completeAutoplay(message);
        return;
      case "edit":
        this.#applyEdit(message);
        return;
      case "setting":
        this.#applySetting(message);
        return;
      case "control":
        return this.#applyControl(message);
      case "advance":
        return this.#applyAdvance(message);
    }
  }

  #insert(message: Extract<QueueMessage, { type: "insert" }>): void {
    try {
      this.#assertActive();
      if (message.options.signal?.aborted) throw new DisTubeError("ABORTED", "Queue insertion was cancelled");
      const { media } = message;
      const items = Object.freeze(
        songsOf(media).map(song => new QueueItem({ song, metadata: message.options.metadata })),
      );
      // Position resolves now, against the committed waiting list, not when the call was made.
      this.#state = insertAt(this.#state, items, message.options.next ? 0 : message.options.at);
      this.#inserted = true;
      this.#cancelAutoplay();
      const timestamp = Date.now();
      if (media instanceof Playlist) this.#emit("queue.playlist.added", { playlist: media, items }, timestamp);
      else for (const item of items) this.#emit("queue.item.added", { item }, timestamp);
      message.resolve(items);
      this.#reconcileAttempt();
      this.#mailbox.post({ type: "start" });
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  #startNext(): void {
    if (this.#destroyRequested || this.#attempt || this.#active || this.#state.current) return;
    const item = this.#state.upcoming[0];
    if (!item) {
      this.#exhaust();
      return;
    }
    const attempt: PlaybackAttempt = { item, controller: new AbortController(), phase: "preparing" };
    this.#attempt = attempt;
    void this.#work
      .start(async () => {
        try {
          const resource = await preparePlaybackResource(
            attempt.item.song,
            this.#sources,
            attempt.controller.signal,
            (error, stage) => this.#report(error, stage),
            (resource, stage) => this.#disposeResource(resource, stage, true),
            resource => this.#voice?.assertResourceCompatible(resource),
          );
          if (!this.#isCurrentAttempt(attempt)) {
            await this.#disposeResource(resource, "stale playback preparation", this.#destroyRequested);
            return;
          }
          this.#mailbox.post({ type: "preparation.completed", attempt, resource });
        } catch (error: unknown) {
          this.#mailbox.post({ type: "preparation.completed", attempt, error });
        }
      })
      .catch(error => this.#report(error, "queue.playback.prepare"));
  }

  #completePreparation(message: Extract<QueueMessage, { type: "preparation.completed" }>): void {
    const attempt = this.#currentAttempt(message.attempt);
    if (!attempt) {
      if (message.resource)
        void this.#disposeResource(message.resource, "stale playback preparation", this.#destroyRequested);
      return;
    }
    if (message.error || !message.resource) {
      this.#failWaitingAttempt(
        attempt,
        asDisTubeError(ErrorCode.SOURCE_FAILED, "Source failed to prepare QueueItem", message.error),
      );
      return;
    }
    const voice = this.#voice;
    if (!voice) {
      this.#rejectPreparedResource(
        attempt,
        message.resource,
        new DisTubeError(ErrorCode.VOICE_FAILED, "Queue has no connected voice"),
      );
      return;
    }
    const resource = message.resource;
    attempt.resource = resource;
    try {
      const acceptance = voice.acceptTrack(resource, { itemId: attempt.item.id }, this);
      attempt.resource = undefined;
      attempt.phase = "activating";
      void this.#work
        .start(async () => {
          try {
            await acceptance.started;
          } catch (error: unknown) {
            this.#mailbox.post({ type: "play.completed", attempt, error });
          }
        })
        .catch(error => this.#report(error, "queue.playback.activate"));
    } catch (error: unknown) {
      this.#rejectPreparedResource(
        attempt,
        resource,
        asDisTubeError(
          ErrorCode.VOICE_FAILED,
          "Voice rejected QueueItem before acceptance",
          error,
          resourceErrorContext(resource.resource),
        ),
      );
    }
  }

  /** The queue retains an unaccepted resource until its cleanup can join the item failure. */
  #rejectPreparedResource(attempt: PlaybackAttempt, resource: OwnedPlaybackResource, primary: DisTubeError): void {
    attempt.resource = resource;
    const cleanup = this.#work.start(async () => {
      let cleanupFailure: Error | undefined;
      try {
        await resource.dispose();
      } catch (error: unknown) {
        cleanupFailure = asError(error, resourceErrorContext(resource.resource));
      }
      attempt.resource = undefined;
      this.#preAcceptanceCleanups.delete(attempt);
      if (!this.#currentAttempt(attempt)) {
        if (cleanupFailure) throw cleanupFailure;
        return;
      }
      const failure = cleanupFailure
        ? new DisTubeError(primary.code, "Playback rejection and cleanup failed", {
            cause: new AggregateError([primary, cleanupFailure], "Playback rejection cleanup failures"),
          })
        : primary;
      this.#mailbox.post({ type: "preparation.completed", attempt, error: failure });
    });
    this.#preAcceptanceCleanups.set(attempt, cleanup);
    void cleanup.catch(error => {
      if (!this.#destroyRequested) this.#report(error, "queue.playback.reject.cleanup");
    });
  }

  #completePlay(message: Extract<QueueMessage, { type: "play.completed" }>): void {
    const attempt = this.#currentAttempt(message.attempt);
    if (!attempt) {
      this.#discardActivatingOutcome(message.attempt);
      // The edit or terminal path that retired this attempt owns disposal after its track stop.
      return;
    }
    const outcome = this.#takeActivatingOutcome(attempt);
    if (message.error) {
      this.#attempt = undefined;
      attempt.controller.abort(this.#stale());
      this.#state = failFirst(this.#state, attempt.item.id);
      this.#emit(
        "queue.item.failed",
        {
          item: attempt.item,
          error: asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to start QueueItem", message.error),
        },
        Date.now(),
      );
      this.#mailbox.post({ type: "start" });
      return;
    }
    const selected = startFirst(this.#state);
    if (!selected || selected.item.id !== attempt.item.id) {
      this.#attempt = undefined;
      return;
    }
    this.#state = selected.state;
    this.#attempt = undefined;
    this.#active = Object.freeze({ item: attempt.item });
    this.#emit("queue.item.started", { item: attempt.item }, Date.now());
    if (outcome) this.#completeOutcome(outcome);
  }

  #completeOutcome(outcome: TrackOutcome): void {
    const active = this.#active;
    if (!active) {
      const attempt = this.#attempt;
      if (attempt && attempt.phase === "activating" && attempt.item.id === outcome.itemId)
        this.#activatingOutcome ??= outcome;
      return;
    }
    if (outcome.itemId !== active.item.id || this.#state.current?.id !== active.item.id) return;
    this.#active = undefined;
    this.#state = finishCurrent(this.#state);
    const timestamp = Date.now();
    if (outcome.kind === "finished") {
      this.#lastPlayed = active.item.song;
      this.#state = this.#repeated(active.item);
      this.#emit("queue.item.finished", { item: active.item }, timestamp);
      this.#remember(active.item, timestamp);
    } else {
      this.#emit("queue.item.failed", { item: active.item, error: outcome.error }, timestamp);
    }
    this.#mailbox.post({ type: "start" });
  }

  #takeActivatingOutcome(attempt: PlaybackAttempt): TrackOutcome | undefined {
    const outcome = this.#activatingOutcome;
    if (!outcome || outcome.itemId !== attempt.item.id) return undefined;
    this.#activatingOutcome = undefined;
    return outcome;
  }

  #discardActivatingOutcome(attempt: PlaybackAttempt): void {
    if (this.#activatingOutcome?.itemId === attempt.item.id) this.#activatingOutcome = undefined;
  }

  /** The state after repeat mode sees a naturally finished occurrence. */
  #repeated(item: QueueItem): QueueState {
    if (this.#state.repeat === RepeatMode.Off) return this.#state;
    const replay = new QueueItem({ song: item.song, metadata: item.metadata });
    return insertAt(this.#state, [replay], this.#state.repeat === RepeatMode.Song ? 0 : undefined);
  }

  /** Nothing is playing and nothing is waiting: try autoplay, otherwise exhaust. */
  #exhaust(): void {
    if (this.#destroyRequested || this.#autoplayLookup || this.#reservations > 0) return;
    const seed = this.#lastPlayed;
    if (seed && this.#state.autoplay) this.#runAutoplay(seed);
    else this.#finish();
  }

  /** Publishes `queue.finished`, then deletes the queue. The guild's voice stays connected. */
  #finish(): void {
    if (this.#exhausted || this.#destroyRequested) return;
    this.#exhausted = true;
    this.#emit("queue.finished", {}, Date.now());
    void this.destroy({ kind: "finished" }).catch(error => this.#report(error, "queue.finish"));
  }

  #runAutoplay(seed: Song): void {
    const lookup = new AbortController();
    this.#autoplayLookup = lookup;
    const exclude = this.#state.history.map(item => item.song);
    void this.#work
      .start(async () => {
        try {
          const song = await relatedSong(seed, this.#sources, lookup.signal, exclude);
          this.#mailbox.post({ type: "autoplay.completed", lookup, seed, ...(song ? { song } : {}) });
        } catch (error: unknown) {
          this.#mailbox.post({ type: "autoplay.completed", lookup, seed, error });
        }
      })
      .catch(error => this.#report(error, "queue.autoplay"));
  }

  #completeAutoplay(message: Extract<QueueMessage, { type: "autoplay.completed" }>): void {
    if (this.#autoplayLookup !== message.lookup) return;
    this.#autoplayLookup = undefined;
    if (this.#destroyRequested) return;
    if (!message.song) {
      // No `related` member, a decline, or an empty result is not a failure anything reported, so the
      // published error carries no cause rather than a fabricated one.
      const error =
        message.error === undefined
          ? new DisTubeError(ErrorCode.SOURCE_FAILED, "Autoplay found no related Song")
          : asDisTubeError(ErrorCode.SOURCE_FAILED, "Autoplay found no related Song", message.error);
      this.#emit("queue.autoplay.failed", { song: message.seed, error }, Date.now());
      this.#finish();
      return;
    }
    const item = new QueueItem({ song: message.song });
    this.#state = insertAt(this.#state, [item]);
    this.#emit("queue.item.added", { item }, Date.now());
    this.#mailbox.post({ type: "start" });
  }

  /** Aborts a pending related lookup so its work stops and its late result is discarded. */
  #cancelAutoplay(): void {
    const lookup = this.#autoplayLookup;
    if (!lookup) return;
    lookup.abort(this.#stale());
    this.#autoplayLookup = undefined;
  }

  #applySetting(message: Extract<QueueMessage, { type: "setting" }>): void {
    try {
      this.#assertActive();
      if ("repeat" in message.setting) {
        this.#state = setRepeat(this.#state, message.setting.repeat);
      } else {
        this.#state = setAutoplay(this.#state, message.setting.autoplay);
        if (!message.setting.autoplay) {
          this.#cancelAutoplay();
          if (this.empty) this.#exhaust();
        }
      }
      message.resolve();
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  #applyEdit(message: Extract<QueueMessage, { type: "edit" }>): void {
    try {
      this.#assertActive();
      const { edit } = message;
      let removed: readonly QueueItem[] = NO_ITEMS;
      switch (edit.kind) {
        case "remove": {
          const removal = this.#remove(edit.target);
          this.#state = removal.state;
          removed = removal.items;
          break;
        }
        case "move":
          this.#state = moveBefore(this.#state, edit.itemId, edit.beforeItemId);
          break;
        case "shuffle":
          this.#state = shuffle(this.#state);
          break;
        case "clear": {
          const removal = clearUpcoming(this.#state);
          this.#state = removal.state;
          removed = removal.items;
          break;
        }
      }
      message.resolve(removed);
      this.#reconcileAttempt();
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  /** Resolves a remove target against the committed waiting list. */
  #remove(target: RemoveTarget): ReturnType<typeof removeRange> {
    if (typeof target === "string") return removeItem(this.#state, target);
    if (typeof target === "number") return removeRange(this.#state, target - 1, target - 1);
    return removeRange(this.#state, target.from - 1, target.to - 1);
  }

  /** Cancels an in-flight attempt whose item an edit moved out of the next slot. */
  #reconcileAttempt(): void {
    const attempt = this.#attempt;
    if (!attempt || this.#state.upcoming[0]?.id === attempt.item.id) return;
    attempt.controller.abort(this.#stale());
    this.#attempt = undefined;
    this.#discardActivatingOutcome(attempt);
    const rejectionCleanup = this.#preAcceptanceCleanups.get(attempt);
    if (rejectionCleanup) {
      void rejectionCleanup.then(
        () => this.#mailbox.post({ type: "start" }),
        () => this.#mailbox.post({ type: "start" }),
      );
      return;
    }
    const resource = attempt.resource;
    const voice = this.#voice;
    if (attempt.phase === "activating" && voice) {
      void this.#work
        .start(async () => {
          await voice.endTrack(attempt.item.id, this).catch(error => this.#report(error, "queue.edit.stop"));
          if (resource) await this.#disposeResource(resource, "resource cleanup after queue edit");
          this.#mailbox.post({ type: "start" });
        })
        .catch(error => this.#report(error, "queue.edit.cleanup"));
      return;
    }
    if (resource) this.#disposeThenStart(resource, "resource cleanup after queue edit");
    else this.#mailbox.post({ type: "start" });
  }

  async #applyControl(message: Extract<QueueMessage, { type: "control" }>): Promise<void> {
    try {
      this.#assertActive();
      const active = this.#active;
      const voice = this.#voice;
      if (!active || !voice || this.#state.current?.id !== active.item.id)
        throw new DisTubeError("INVALID_STATE", "Queue has no current QueueItem");
      const { control } = message;
      if (control === "pause" && this.#state.status === QueueStatus.Paused) return message.resolve();
      if (control === "resume" && this.#state.status === QueueStatus.Playing) return message.resolve();
      if (control === "seek") {
        const seconds = message.seconds;
        if (!Number.isFinite(seconds) || (seconds ?? -1) < 0)
          throw new DisTubeError("INVALID_ARGUMENT", "Seek seconds must be non-negative");
        const duration = active.item.song.duration;
        if (duration !== undefined && duration > 0 && (seconds as number) > duration)
          throw new DisTubeError("INVALID_ARGUMENT", "Seek seconds exceed the track duration");
        await voice.seek(seconds as number, this);
      } else if (control === "pause") await voice.pause(this);
      else await voice.resume(this);
      this.#commit();
      if (control === "pause") this.#state = setStatus(this.#state, QueueStatus.Paused);
      else if (control === "resume") this.#state = setStatus(this.#state, QueueStatus.Playing);
      message.resolve();
    } catch (error: unknown) {
      message.reject(this.#destroyRequested ? this.#stale() : error);
    }
  }

  async #applyAdvance(message: Extract<QueueMessage, { type: "advance" }>): Promise<void> {
    try {
      this.#assertActive();
      const { mode } = message;
      const active = this.#active;
      const voice = this.#voice;
      if (mode.kind === "skip" && (!active || this.#state.current?.id !== active.item.id))
        throw new DisTubeError("INVALID_STATE", "Cannot skip a queue with no active track");
      if (mode.kind === "previous" && this.#state.history.length === 0)
        throw new DisTubeError("INVALID_STATE", "Queue has no history to return to");
      const targetIndex = mode.kind === "jump" ? this.#jumpIndex(mode.target) : 0;

      const ending = active
        ? this.#work.start(async () => {
            // Register cleanup before dropping the active item, so terminal stop can still join it.
            this.#active = undefined;
            const stopped = voice
              ? await voice.endTrack(active.item.id, this).then(() => undefined, asError)
              : undefined;
            const failure = cleanupFailure(
              ErrorCode.VOICE_FAILED,
              "Player failed to end the track cleanly",
              stopped ? [stopped] : [],
              "Advance cleanup failures",
            );
            if (failure) throw failure;
          })
        : Promise.resolve();
      const stopped = await ending.then(() => undefined, asError);
      this.#commit();
      const timestamp = Date.now();
      const state = finishCurrent(this.#state);
      const ended: QueueItem[] = [];
      if (mode.kind === "skip" && active) {
        this.#lastPlayed = active.item.song;
        this.#state = state;
        this.#emit("queue.item.finished", { item: active.item }, timestamp);
        ended.push(active.item);
      } else if (mode.kind === "jump") {
        // jumpTo ends the current item itself, so it sees the state that still carries it.
        const jumped = jumpTo(this.#state, targetIndex, mode.requeue);
        this.#state = jumped.state;
        if (active) this.#lastPlayed = active.item.song;
        if (!mode.requeue) ended.push(...jumped.skipped);
      } else if (mode.kind === "previous") {
        const popped = popHistory(state);
        if (!popped) throw this.#stale();
        const replay = new QueueItem({ song: popped.item.song, metadata: popped.item.metadata });
        this.#state = insertAt(popped.state, [replay, ...(active ? [active.item] : [])], 0);
      }
      for (const item of ended) this.#remember(item, timestamp);
      this.#reconcileAttempt();
      this.#mailbox.post({ type: "start" });
      if (stopped) throw stopped;
      message.resolve();
    } catch (error: unknown) {
      message.reject(this.#destroyRequested ? this.#stale() : error);
    }
  }

  /** Resolves a jump target to a zero-based index in the committed waiting list. */
  #jumpIndex(target: string | number): number {
    const index = typeof target === "string" ? this.#state.upcoming.findIndex(item => item.id === target) : target - 1;
    if (index < 0 || index >= this.#state.upcoming.length)
      throw new DisTubeError("INVALID_STATE", "Jump target is not upcoming in this queue");
    return index;
  }

  #failWaitingAttempt(attempt: PlaybackAttempt, error: DisTubeError): void {
    if (this.#attempt !== attempt) return;
    this.#attempt = undefined;
    this.#discardActivatingOutcome(attempt);
    attempt.controller.abort(this.#stale());
    this.#state = failFirst(this.#state, attempt.item.id);
    this.#emit("queue.item.failed", { item: attempt.item, error }, Date.now());
    if (attempt.resource) this.#disposeThenStart(attempt.resource, "resource cleanup after source failure");
    else this.#mailbox.post({ type: "start" });
  }

  #currentAttempt(attempt: PlaybackAttempt): PlaybackAttempt | undefined {
    return this.#attempt === attempt && !this.#destroyRequested ? attempt : undefined;
  }

  #isCurrentAttempt(attempt: PlaybackAttempt): boolean {
    return this.#currentAttempt(attempt) === attempt;
  }

  #scheduleTerminalDisposal(resource: OwnedPlaybackResource, predecessor: Promise<void>): void {
    void this.#work
      .start(async () => {
        await predecessor.catch(() => undefined);
        await resource.dispose();
      })
      .catch(() => undefined);
  }

  #disposeResource(resource: OwnedPlaybackResource, stage: string, propagate = false): Promise<void> {
    return this.#work.start(async () => {
      try {
        await resource.dispose();
      } catch (error: unknown) {
        if (propagate || this.#destroyRequested) throw error;
        this.#report(error, stage);
      }
    });
  }

  #disposeThenStart(resource: OwnedPlaybackResource, stage: string): void {
    void this.#disposeResource(resource, stage)
      .then(() => {
        this.#mailbox.post({ type: "start" });
      })
      .catch(error => this.#report(error, stage));
  }

  #emitDeletion(): void {
    if (this.#destroyEventEmitted) return;
    if (!this.#published) return;
    this.#destroyEventEmitted = true;
    this.#emit("queue.deleted", {}, Date.now());
  }

  /** Appends an ended occurrence to the bounded history and publishes the append. */
  #remember(item: QueueItem, timestamp: number): void {
    if (this.#historySize <= 0) return;
    this.#state = pushHistory(this.#state, item, this.#historySize);
    this.#emit("queue.history.added", { item }, timestamp);
  }

  #assertActive(): void {
    if (this.#destroyRequested) throw new DisTubeError("INVALID_STATE", "DisTubeQueue is deleted");
  }

  /**
   * Gate every state commit that follows an await.
   *
   * Terminal authority is accepted synchronously, so a decision suspended on a voice effect can resume
   * after `queue.deleted` published. Such a decision commits nothing and settles as superseded instead.
   */
  #commit(): void {
    if (this.#destroyRequested) throw this.#stale();
  }

  #stale(): DisTubeError {
    return new DisTubeError("INVALID_STATE", "Queue operation was superseded");
  }

  #report(error: unknown, stage: string): void {
    this.#events.report({
      severity: "error",
      stage,
      message: `DisTubeQueue ${this.#queueId} background operation failed`,
      error: asError(error),
      detail: Object.freeze({ queueId: this.#queueId }),
    });
  }

  /** Publishes one event with the transition's own timestamp, not the dispatch time. */
  #emit<Name extends QueueOwnedEvent>(
    name: Name,
    detail: Omit<DisTubeEventMap[Name], keyof BaseQueueEvent>,
    timestamp: number,
  ): void {
    this.#events.emit(
      name,
      Object.freeze({
        guildId: this.guildId,
        queue: this.#facade,
        state: this.#state,
        timestamp,
        ...detail,
      }) as never,
    );
  }
}

function validateRemoveTarget(target: RemoveTarget): void {
  if (typeof target === "string") {
    if (target.length === 0) throw new DisTubeError("INVALID_ARGUMENT", "Occurrence ID must be a non-empty string");
    return;
  }
  if (typeof target === "number") {
    if (!Number.isInteger(target) || target < 1)
      throw new DisTubeError("INVALID_ARGUMENT", "Queue position must be a positive integer");
    return;
  }
  if (
    !target ||
    typeof target !== "object" ||
    !Number.isInteger(target.from) ||
    !Number.isInteger(target.to) ||
    target.from < 1 ||
    target.to < target.from
  ) {
    throw new DisTubeError("INVALID_ARGUMENT", "Range must be a non-inverted pair of positive positions");
  }
}
