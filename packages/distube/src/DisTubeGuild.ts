import type { ResolvableInput } from "./contracts";
import { QueueStatus, RepeatMode } from "./enums";
import { asDisTubeError, DisTubeError, ErrorCode, type FailureCode } from "./errors";
import type { BaseQueueEvent, DisTubeEventEmitter, DisTubeEventMap, DisTubeEventName } from "./events";
import { Playlist, QueueItem, type Song } from "./media";
import { type OwnedPlaybackResource, preparePlaybackResource } from "./playback/prepare";
import { relatedSong } from "./playback/related";
import { type SourceCatalog, songsOf } from "./playback/sources";
import { validatePlaybackRequest } from "./playback/validation";
import { cancelPlaybackAttempt, createPlaybackAttempt, isCurrentPlaybackAttempt } from "./queue/attempt";
import { decideControl, type QueueControl } from "./queue/control";
import { asError, cleanupFailure } from "./queue/failures";
import { Mailbox } from "./queue/mailbox";
import type {
  ActivePlayback,
  AdvanceMode,
  EnqueueOptions,
  PlaybackAttempt,
  QueueEdit,
  QueueMessage,
} from "./queue/protocol";
import {
  clearQueue,
  failFirst,
  finishCurrent,
  frontItems,
  IDLE_QUEUE_STATE,
  insertItems,
  type QueueState,
  removeItem,
  setStatus,
  startFirst,
} from "./queue/state";
import type { QueueTerminalCause } from "./queue/terminal";
import type { LeasedPlayerOutcome, QueuePlayerEffect, QueueVoice, QueueVoiceLease } from "./queue/voice";
import { TrackedWork } from "./utils/tracked-work";

/** The events a queue publishes itself; `queue.created` belongs to the registry that made it. */
type QueueOwnedEvent = Exclude<DisTubeEventName, "queue.created" | "voice.disconnected">;

const NO_ITEMS: readonly QueueItem[] = Object.freeze([]);

/**
 * Public guild playback-session facade.
 *
 * `Metadata` is the client's caller-metadata type, threaded so a read of `item.metadata` needs no cast.
 */
export interface GuildState<Metadata = unknown> {
  readonly current: QueueItem<Metadata> | undefined;
  readonly upcoming: readonly QueueItem<Metadata>[];
  readonly status: "idle" | "playing" | "paused";
}

export type DisTubeGuild<Metadata = unknown> = {
  readonly guildId: string;
  readonly state: GuildState<Metadata>;
  readonly position: number;
  enqueue(input: ResolvableInput, options?: EnqueueOptions<Metadata>): Promise<readonly QueueItem<Metadata>[]>;
  remove(itemId: string): Promise<void>;
  move(itemId: string, beforeItemId?: string): Promise<void>;
  skip(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(seconds: number): Promise<void>;
  stop(): Promise<void>;
};

/** Package-private implementation of the GuildQueue facade. */
export class GuildQueueImpl {
  readonly #facade: DisTubeGuild;
  /** Internal identity for lease and authority matching; never public, since queues are keyed by guild. */
  readonly #queueId: string;
  readonly guildId: string;
  readonly #sources: SourceCatalog;
  readonly #events: DisTubeEventEmitter;
  /** Frees the guild and hands the registry this deletion's completion so shutdown can join it. */
  readonly #unregister: (completion: Promise<void>) => void;
  readonly #mailbox: Mailbox<QueueMessage>;
  readonly #work = new TrackedWork();
  readonly #leaseController = new AbortController();
  #voice?: QueueVoice;
  #autoplayListener?: (enabled: boolean) => void;
  #lease?: QueueVoiceLease;
  #leaseClose?: Promise<void>;
  #nextAttemptGeneration = 0;
  #state: QueueState = IDLE_QUEUE_STATE;
  #attempt?: PlaybackAttempt;
  /** A Player can report its first terminal outcome before activation commits in the mailbox. */
  #activatingOutcome?: LeasedPlayerOutcome;
  #active?: ActivePlayback;
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
    binding: { readonly queueId: string; readonly guildId: string },
    sources: SourceCatalog,
    events: DisTubeEventEmitter,
    unregister: (completion: Promise<void>) => void = () => undefined,
    enqueue: (input: ResolvableInput, options?: EnqueueOptions) => Promise<readonly QueueItem[]> = () =>
      Promise.reject(new DisTubeError("INVALID_STATE", "Queue is not registered")),
    stop: () => Promise<void> = () => this.destroy(),
  ) {
    this.#queueId = binding.queueId;
    this.guildId = binding.guildId;
    this.#sources = sources;
    this.#events = events;
    this.#unregister = unregister;
    this.#mailbox = new Mailbox(message => this.#handle(message));
    const self = this;
    const facade = {
      get guildId(): string {
        return self.guildId;
      },
      get state(): GuildState {
        return self.snapshot();
      },
      get position(): number {
        return self.currentTime;
      },
      enqueue,
      remove: async (itemId: string): Promise<void> => {
        await self.remove(itemId);
      },
      move: (itemId: string, beforeItemId?: string): Promise<void> => self.move(itemId, beforeItemId),
      skip: this.skip.bind(this),
      pause: this.pause.bind(this),
      resume: this.resume.bind(this),
      seek: this.seek.bind(this),
      stop,
    };
    Object.freeze(facade);
    this.#facade = facade;
  }

  /** Package-private public view; the implementation never crosses the package boundary. */
  get facade(): DisTubeGuild {
    return this.#facade;
  }

  /** Binds the exact Voice generation that completed this queue's play transaction. */
  attachVoice(voice: QueueVoice): void {
    this.#assertActive();
    if (this.#voice === voice) return;
    if (this.#voice) throw new DisTubeError(ErrorCode.QUEUE_FAILED, "Queue cannot attach to a replacement Voice");
    this.#voice = voice;
    // The queue learns about committed autoplay changes through one subscription per attachment.
    const listener = (enabled: boolean): void => {
      this.#mailbox.post({ type: "autoplay.changed", enabled });
    };
    this.#autoplayListener = listener;
    voice.onAutoplayChanged(listener);
  }

  detachVoice(voice: QueueVoice): void {
    if (this.#voice !== voice) return;
    this.#voice = undefined;
    this.#autoplayListener = undefined;
  }

  get state(): QueueState {
    return this.#state;
  }

  snapshot(): GuildState {
    return Object.freeze({ current: this.#state.current, upcoming: this.#state.items, status: this.#state.status });
  }

  get empty(): boolean {
    return (
      this.#reservations === 0 &&
      !this.#active &&
      !this.#attempt &&
      !this.#state.current &&
      this.#state.items.length === 0
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
      Object.freeze({ guildId: this.guildId, queue: this.#facade, state: this.snapshot(), timestamp: Date.now() }),
    );
  }

  /** Elapsed seconds of the current occurrence, or `0` when nothing is playing. */
  get currentTime(): number {
    const active = this.#active;
    const lease = this.#lease;
    return active && lease ? lease.position(active.authority) : 0;
  }

  insert(media: Song | Playlist, options: EnqueueOptions = {}): Promise<readonly QueueItem[]> {
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

  /** Removes waiting occurrences by ID, by zero-based index, or by inclusive index range. */
  remove(target: string): Promise<readonly QueueItem[]> {
    if (typeof target !== "string" || target.length === 0)
      return Promise.reject(new DisTubeError("INVALID_ARGUMENT", "Occurrence ID must be a non-empty string"));
    return this.#edit({ kind: "remove", target });
  }

  /** Ends the current occurrence and plays the next waiting one. */
  skip(): Promise<void> {
    return this.#advance({ kind: "skip" });
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

  /** The single terminal operation: ends playback and deletes the queue, leaving the Voice connected. */
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
    this.#detachAutoplayListener();
    this.#leaseController.abort(this.#stale());
    this.#cancelAutoplay();
    const attempt = cancelPlaybackAttempt(this.#attempt, this.#stale());
    this.#attempt = undefined;
    this.#activatingOutcome = undefined;
    const active = this.#active;
    this.#active = undefined;
    this.#state = clearQueue(this.#state);
    this.#unregister(terminal);
    this.#mailbox.close();

    if (cause.kind === "voice-loss" && active) {
      this.#emit(
        "queue.item.failed",
        {
          item: active.item,
          error: asDisTubeError(ErrorCode.VOICE_FAILED, "Voice disconnected terminally", cause.error),
        },
        Date.now(),
      );
    }
    this.#emitDeletion();

    // Calling close fences the lease in this stack, before another queue can acquire the Voice.
    const close = this.#closeLease();
    const reset = this.#voice?.resetQueueFilters();
    if (reset) void this.#work.start(() => reset).catch(() => undefined);
    const resources = [...new Set([attempt?.resource, active?.resource].filter(Boolean))] as OwnedPlaybackResource[];
    for (const resource of resources) this.#scheduleTerminalDisposal(resource, close);

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

  #control(control: QueueControl, seconds?: number): Promise<void> {
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

  #handle(message: QueueMessage): void | Promise<void> {
    switch (message.type) {
      case "insert":
        this.#insert(message);
        return;
      case "start":
        this.#startNext();
        return;
      case "lease.ready":
        this.#completeLease(message);
        return;
      case "preparation.completed":
        this.#completePreparation(message);
        return;
      case "play.completed":
        this.#completePlay(message);
        return;
      case "lease.outcome":
        this.#completeOutcome(message.outcome);
        return;
      case "autoplay.completed":
        this.#completeAutoplay(message);
        return;
      case "edit":
        this.#applyEdit(message);
        return;
      case "autoplay.changed":
        this.#applyAutoplayChange(message.enabled);
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
      this.#state = insertItems(this.#state, items);
      this.#inserted = true;
      this.#cancelAutoplay();
      const timestamp = Date.now();
      if (media instanceof Playlist) this.#emit("queue.playlist.added", { playlist: media, items }, timestamp);
      else for (const item of items) this.#emit("queue.item.added", { item }, timestamp);
      message.resolve(items);
      this.#mailbox.post({ type: "start" });
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  #startNext(): void {
    if (this.#destroyRequested || this.#attempt || this.#active || this.#state.current) return;
    if (!this.#state.items[0]) {
      this.#exhaust();
      return;
    }
    const attempt = createPlaybackAttempt(
      this.#state.items[0] as QueueItem,
      ++this.#nextAttemptGeneration,
      this.#queueId,
    );
    this.#attempt = attempt;
    this.#acquireLease(attempt);
  }

  #acquireLease(attempt: PlaybackAttempt): void {
    const voice = this.#voice;
    if (!voice) {
      this.#mailbox.post({ type: "lease.ready", attempt, error: this.#stale() });
      return;
    }
    void this.#work
      .start(async () => {
        try {
          let lease = this.#lease;
          if (!lease) {
            lease = await voice.acquireQueue({
              queueId: this.#queueId,
              signal: this.#leaseController.signal,
              onOutcome: outcome => this.#mailbox.post({ type: "lease.outcome", outcome }),
            });
          }
          if (!this.#isCurrentAttempt(attempt)) {
            if (lease !== this.#lease) void this.#work.start(() => lease.close()).catch(() => undefined);
            return;
          }
          this.#lease = lease;
          this.#mailbox.post({ type: "lease.ready", attempt, lease });
        } catch (error: unknown) {
          this.#mailbox.post({ type: "lease.ready", attempt, error });
        }
      })
      .catch(error => this.#report(error, "queue.lease.acquire"));
  }

  #completeLease(message: Extract<QueueMessage, { type: "lease.ready" }>): void {
    const attempt = this.#currentAttempt(message.attempt);
    if (!attempt) {
      const lease = message.lease;
      if (lease && lease !== this.#lease) void this.#work.start(() => lease.close()).catch(() => undefined);
      return;
    }
    if (message.error || !message.lease) {
      this.#failWaitingAttempt(
        attempt,
        asDisTubeError(ErrorCode.VOICE_FAILED, "Voice failed to provide a queue lease", message.error),
      );
      return;
    }
    attempt.phase = "preparing";
    this.#runPreparation(attempt);
  }

  #runPreparation(attempt: PlaybackAttempt): void {
    void this.#work
      .start(async () => {
        try {
          const resource = await preparePlaybackResource(
            attempt.item.song,
            this.#sources,
            attempt.controller.signal,
            (error, stage) => this.#report(error, stage),
            (resource, stage) => this.#disposeResource(resource, stage, this.#destroyRequested),
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
    const lease = this.#lease;
    if (!lease) {
      this.#failWaitingAttempt(attempt, this.#stale());
      void this.#disposeResource(message.resource, "missing queue lease", this.#destroyRequested);
      return;
    }
    const resource = message.resource;
    attempt.resource = resource;
    attempt.phase = "activating";
    void this.#work
      .start(async () => {
        const request = validatePlaybackRequest({ itemId: attempt.item.id, resource: resource.resource });
        const result = await this.#runLeaseEffect(lease, { kind: "play", authority: attempt.authority, request });
        this.#mailbox.post({
          type: "play.completed",
          attempt,
          resource,
          ...(result.error === undefined ? {} : { error: result.error }),
        });
      })
      .catch(error => this.#report(error, "queue.playback.activate"));
  }

  #completePlay(message: Extract<QueueMessage, { type: "play.completed" }>): void {
    const attempt = this.#currentAttempt(message.attempt);
    if (!attempt) {
      this.#discardActivatingOutcome(message.attempt);
      void this.#disposeResource(message.resource, "stale queue activation", this.#destroyRequested);
      return;
    }
    const outcome = this.#takeActivatingOutcome(attempt);
    if (message.error) {
      this.#attempt = undefined;
      cancelPlaybackAttempt(attempt, this.#stale());
      this.#state = failFirst(this.#state, attempt.item.id);
      this.#emit(
        "queue.item.failed",
        { item: attempt.item, error: playerFailure("Player failed to start QueueItem", message.error) },
        Date.now(),
      );
      this.#disposeThenStart(message.resource, "resource cleanup after play rejection");
      return;
    }
    const selected = startFirst(this.#state);
    if (!selected || selected.item.id !== attempt.item.id) {
      this.#attempt = undefined;
      void this.#disposeResource(message.resource, "superseded queue activation", this.#destroyRequested);
      return;
    }
    this.#state = selected.state;
    this.#attempt = undefined;
    this.#active = Object.freeze({ item: attempt.item, authority: attempt.authority, resource: message.resource });
    this.#emit("queue.item.started", { item: attempt.item }, Date.now());
    if (outcome) this.#completeOutcome(outcome);
  }

  #completeOutcome(outcome: LeasedPlayerOutcome): void {
    const active = this.#active;
    const lease = this.#lease;
    if (!active) {
      const attempt = this.#attempt;
      if (attempt && this.#canAcceptActivatingOutcome(attempt, outcome)) this.#activatingOutcome ??= outcome;
      return;
    }
    if (
      !lease ||
      outcome.authority.queueId !== this.#queueId ||
      outcome.authority.itemId !== active.item.id ||
      outcome.authority.attemptGeneration !== active.authority.attemptGeneration ||
      outcome.authority.leaseGeneration !== lease.generation ||
      this.#state.current?.id !== active.item.id
    ) {
      return;
    }
    this.#active = undefined;
    this.#state = finishCurrent(this.#state);
    const timestamp = Date.now();
    if (outcome.event.type === "finished") {
      this.#remember([active.item]);
      this.#state = this.#repeated(active.item);
      this.#emit("queue.item.finished", { item: active.item }, timestamp);
    } else {
      this.#emit(
        "queue.item.failed",
        {
          item: active.item,
          error: playerFailure("Player reported playback failure", outcome.event.error),
        },
        timestamp,
      );
    }
    this.#disposeThenStart(active.resource, "resource cleanup after Player outcome");
  }

  #canAcceptActivatingOutcome(attempt: PlaybackAttempt, outcome: LeasedPlayerOutcome): boolean {
    const lease = this.#lease;
    return (
      this.#isCurrentAttempt(attempt) &&
      attempt.phase === "activating" &&
      lease !== undefined &&
      this.#state.items[0]?.id === attempt.item.id &&
      outcome.authority.queueId === this.#queueId &&
      outcome.authority.itemId === attempt.item.id &&
      outcome.authority.attemptGeneration === attempt.authority.attemptGeneration &&
      outcome.authority.leaseGeneration === lease.generation
    );
  }

  #takeActivatingOutcome(attempt: PlaybackAttempt): LeasedPlayerOutcome | undefined {
    const outcome = this.#activatingOutcome;
    if (!outcome || !this.#matchesActivatingOutcome(attempt, outcome)) return undefined;
    this.#activatingOutcome = undefined;
    return outcome;
  }

  #discardActivatingOutcome(attempt: PlaybackAttempt): void {
    const outcome = this.#activatingOutcome;
    if (outcome && this.#matchesActivatingOutcome(attempt, outcome)) this.#activatingOutcome = undefined;
  }

  #matchesActivatingOutcome(attempt: PlaybackAttempt, outcome: LeasedPlayerOutcome): boolean {
    return (
      outcome.authority.queueId === this.#queueId &&
      outcome.authority.itemId === attempt.item.id &&
      outcome.authority.attemptGeneration === attempt.authority.attemptGeneration
    );
  }

  /** The state after repeat mode sees a naturally finished occurrence. */
  #repeated(item: QueueItem): QueueState {
    const repeatMode = this.#voice?.repeatMode ?? RepeatMode.Off;
    if (repeatMode === RepeatMode.Off) return this.#state;
    const replay = new QueueItem({ song: item.song, metadata: item.metadata });
    return repeatMode === RepeatMode.Song ? frontItems(this.#state, [replay]) : insertItems(this.#state, [replay]);
  }

  /** Nothing is playing and nothing is waiting: try autoplay, otherwise exhaust. */
  #exhaust(): void {
    if (this.#destroyRequested || this.#autoplayLookup || this.#reservations > 0) return;
    const seed = this.#voice?.lastPlayedSong()?.song;
    if (seed && this.#voice?.autoplay) this.#runAutoplay(seed);
    else this.#finish();
  }

  /** Publishes `queue.finished`, then deletes the queue. The guild's Voice stays connected. */
  #finish(): void {
    if (this.#exhausted || this.#destroyRequested) return;
    this.#exhausted = true;
    this.#emit("queue.finished", {}, Date.now());
    void this.destroy({ kind: "finished" }).catch(error => this.#report(error, "queue.finish"));
  }

  #runAutoplay(seed: Song): void {
    const lookup = new AbortController();
    this.#autoplayLookup = lookup;
    void this.#work
      .start(async () => {
        try {
          const song = await relatedSong(seed, this.#sources, lookup.signal);
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
    this.#state = insertItems(this.#state, [item]);
    this.#emit("queue.item.added", { item }, Date.now());
    this.#mailbox.post({ type: "start" });
  }

  /** Aborts a pending related lookup so its work stops and its late result is discarded. */
  #cancelAutoplay(): boolean {
    const lookup = this.#autoplayLookup;
    if (!lookup) return false;
    lookup.abort(this.#stale());
    this.#autoplayLookup = undefined;
    return true;
  }

  /** Retires a pending related lookup when the Voice commits `setAutoplay(false)` outside the queue. */
  #applyAutoplayChange(enabled: boolean): void {
    if (this.#destroyRequested) return;
    this.#cancelAutoplay();
    if (!enabled && !this.#active && !this.#attempt && !this.#state.current && this.#state.items.length === 0) {
      this.#exhaust();
    }
  }

  #applyEdit(message: Extract<QueueMessage, { type: "edit" }>): void {
    try {
      this.#assertActive();
      const { edit } = message;
      switch (edit.kind) {
        case "remove": {
          if (!this.#state.items.some(item => item.id === edit.target))
            throw new DisTubeError("INVALID_STATE", "Occurrence is not upcoming in this queue");
          const removal = removeItem(this.#state, edit.target);
          this.#state = removal.state;
          message.resolve(removal.items);
          break;
        }
        case "move": {
          const { itemId, beforeItemId } = edit;
          if (
            typeof itemId !== "string" ||
            !itemId ||
            (beforeItemId !== undefined && (typeof beforeItemId !== "string" || !beforeItemId))
          ) {
            throw new DisTubeError("INVALID_ARGUMENT", "Occurrence IDs must be non-empty strings");
          }
          const item = this.#state.items.find(item => item.id === itemId);
          if (!item || (beforeItemId !== undefined && !this.#state.items.some(item => item.id === beforeItemId))) {
            throw new DisTubeError("INVALID_STATE", "Occurrence is not upcoming in this queue");
          }
          if (itemId !== beforeItemId) {
            const upcoming = this.#state.items.filter(entry => entry !== item);
            const index =
              beforeItemId === undefined ? upcoming.length : upcoming.findIndex(entry => entry.id === beforeItemId);
            this.#state = Object.freeze({ ...this.#state, items: Object.freeze(upcoming.toSpliced(index, 0, item)) });
          }
          message.resolve(NO_ITEMS);
          break;
        }
      }
      this.#reconcileAttempt();
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  /** Cancels an in-flight attempt whose item an edit moved out of the next slot. */
  #reconcileAttempt(): void {
    const attempt = this.#attempt;
    if (!attempt || this.#state.items[0]?.id === attempt.item.id) return;
    cancelPlaybackAttempt(attempt, this.#stale());
    this.#attempt = undefined;
    this.#discardActivatingOutcome(attempt);
    const resource = attempt.resource;
    const lease = this.#lease;
    if (attempt.phase === "activating" && lease) {
      void this.#work
        .start(async () => {
          await this.#runLeaseEffect(lease, { kind: "stop", authority: attempt.authority });
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
      const decision = decideControl(this.#state, active, message.control, message.seconds);
      if (decision.kind === "noop") {
        message.resolve();
        return;
      }
      if (!active || !this.#lease) {
        throw new DisTubeError("INVALID_STATE", "Queue has no current QueueItem");
      }
      const effect: QueuePlayerEffect =
        decision.control === "seek"
          ? { kind: "seek", authority: active.authority, seconds: decision.seconds as number }
          : { kind: decision.control, authority: active.authority };
      const result = await this.#runLeaseEffect(this.#lease, effect);
      this.#commit();
      if (result.error) throw playerFailure(`Player failed to ${message.control}`, result.error);
      if (message.control === "pause") this.#state = setStatus(this.#state, QueueStatus.Paused);
      else if (message.control === "resume") this.#state = setStatus(this.#state, QueueStatus.Playing);
      message.resolve();
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  async #applyAdvance(message: Extract<QueueMessage, { type: "advance" }>): Promise<void> {
    try {
      this.#assertActive();
      const active = this.#active;
      const lease = this.#lease;
      if (!active || !lease || this.#state.current?.id !== active.item.id) {
        throw new DisTubeError("INVALID_STATE", "Cannot advance a queue with no active track");
      }
      const stopped = await this.#runLeaseEffect(lease, { kind: "stop", authority: active.authority });
      this.#commit();
      this.#active = undefined;
      this.#state = finishCurrent(this.#state);
      this.#remember([active.item]);
      this.#emit("queue.item.finished", { item: active.item }, Date.now());
      const disposal = await this.#disposeResource(active.resource, "resource cleanup after queue advance", true).then(
        () => undefined,
        error => error,
      );
      const failures = [
        ...(stopped.error === undefined ? [] : [asError(stopped.error)]),
        ...(disposal === undefined ? [] : [asError(disposal)]),
      ];
      this.#mailbox.post({ type: "start" });
      const failure = cleanupFailure(
        ErrorCode.VOICE_FAILED,
        "Player failed to end the track cleanly",
        failures,
        "Advance cleanup failures",
      );
      if (failure) throw failure;
      message.resolve();
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  #failWaitingAttempt(attempt: PlaybackAttempt, error: DisTubeError): void {
    if (this.#attempt !== attempt) return;
    this.#attempt = undefined;
    this.#discardActivatingOutcome(attempt);
    cancelPlaybackAttempt(attempt, this.#stale());
    this.#state = failFirst(this.#state, attempt.item.id);
    this.#emit("queue.item.failed", { item: attempt.item, error }, Date.now());
    if (attempt.resource) this.#disposeThenStart(attempt.resource, "resource cleanup after source failure");
    else this.#mailbox.post({ type: "start" });
  }

  #currentAttempt(attempt: PlaybackAttempt): PlaybackAttempt | undefined {
    return isCurrentPlaybackAttempt(this.#attempt, attempt, this.#destroyRequested) ? attempt : undefined;
  }

  #isCurrentAttempt(attempt: PlaybackAttempt): boolean {
    return this.#currentAttempt(attempt) === attempt;
  }

  #detachAutoplayListener(): void {
    const voice = this.#voice;
    if (voice) voice.detachAutoplayListener(this.#autoplayListener);
    this.#autoplayListener = undefined;
  }

  #runLeaseEffect(lease: QueueVoiceLease, effect: QueuePlayerEffect): Promise<Readonly<{ error?: unknown }>> {
    return this.#work.start(async () => {
      try {
        await lease.run(effect);
        return Object.freeze({});
      } catch (error: unknown) {
        return Object.freeze({ error });
      }
    });
  }

  #closeLease(): Promise<void> {
    if (this.#leaseClose) return this.#leaseClose;
    const lease = this.#lease;
    if (!lease) return Promise.resolve();
    const close = this.#work.start(() => lease.close());
    this.#leaseClose = close.finally(() => {
      if (this.#lease === lease) this.#lease = undefined;
    });
    void this.#leaseClose.catch(() => undefined);
    return this.#leaseClose;
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

  /** Appends played occurrences to the Voice's bounded history. */
  #remember(items: readonly QueueItem[]): void {
    this.#voice?.rememberPlayed(items);
  }

  #assertActive(): void {
    if (this.#destroyRequested) {
      throw new DisTubeError("INVALID_STATE", "DisTubeGuild is destroyed");
    }
  }

  /**
   * Gate every state commit that follows an await.
   *
   * Terminal authority is accepted synchronously, so a decision suspended on a Player effect or a
   * provider call can resume after `queue.deleted` published. Such a decision commits no QueueState,
   * no history entry, no item outcome, and no event; it settles as superseded instead.
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
      message: `GuildQueue ${this.#queueId} background operation failed`,
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
        state: this.snapshot(),
        timestamp,
        ...detail,
      }) as never,
    );
  }
}

const PLAYER_CODES = [ErrorCode.VOICE_FAILED, ErrorCode.UNSUPPORTED, ErrorCode.INVALID_STATE] as const;

/** Maps a backend rejection to the public error the accepted Player effect can return. */
function playerFailure(message: string, error: unknown, allowInvalidArgument = false): DisTubeError {
  return compatibleFailure(
    ErrorCode.VOICE_FAILED,
    message,
    error,
    allowInvalidArgument ? [...PLAYER_CODES, ErrorCode.INVALID_ARGUMENT] : PLAYER_CODES,
  );
}

function compatibleFailure(
  code: FailureCode,
  message: string,
  error: unknown,
  accepted: readonly ErrorCode[],
): DisTubeError {
  if (error instanceof DisTubeError && accepted.includes(error.code)) return error;
  return asDisTubeError(code, message, error);
}
