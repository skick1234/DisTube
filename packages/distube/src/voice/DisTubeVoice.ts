import type {
  Engine,
  FilterEntry,
  PlaybackCapabilities,
  PlaybackResource,
  Player,
  PlayerEvent,
  VoiceGatewayData,
  VoiceSession,
  VoiceSessionEvent,
  VoiceTarget,
} from "../contracts";
import { asDisTubeError, asError, DisTubeError, ErrorCode } from "../errors";
import type { DisTubeEventEmitter } from "../events";
import {
  assertPlaybackResourceCompatible,
  consumePlaybackResource,
  isPlaybackResourceSeekable,
  type OwnedPlaybackResource,
  resourceErrorContext,
} from "../playback/resource";
import { cleanupFailure } from "../queue/failures";
import { settleGrowing, TrackedWork } from "../utils/tracked-work";
import { createFilterManager, type FilterChange, type FilterManager, NO_FILTERS } from "./filters";
import type { VoiceChannelTarget } from "./target";

export interface PlayTrackOptions {
  /** Correlates the track's `voice.track.*` events with the caller's own identity. */
  readonly itemId?: string;
}

/** Public guild voice facade: the connection, its Player and the settings that live as long as it does. */
export type DisTubeVoice<Target = VoiceChannelTarget> = {
  readonly guildId: string;
  readonly channelId: string;
  readonly volume: number;
  readonly selfDeaf: boolean;
  readonly selfMute: boolean;
  readonly filters: FilterManager;
  readonly capabilities: PlaybackCapabilities;
  readonly seekable: boolean;
  /** Elapsed seconds of the active track, or `0`. */
  readonly position: number;
  /** Starts a track directly. Rejects `INVALID_STATE` while a DisTubeQueue is attached. */
  play(resource: PlaybackResource, options?: PlayTrackOptions): Promise<void>;
  /** Ends the active track and keeps the voice usable. */
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(seconds: number): Promise<void>;
  move(channel: Target): Promise<void>;
  /** Leaves the channel: deletes any attached queue, then releases the Player and the session. Idempotent. */
  leave(): Promise<void>;
  setVolume(percent: number): Promise<void>;
  setSelfDeaf(enabled: boolean): Promise<void>;
  setSelfMute(enabled: boolean): Promise<void>;
};

/** How one accepted track ended, as the attached queue learns it. */
export type TrackOutcome =
  | Readonly<{ kind: "finished"; itemId: string }>
  | Readonly<{ kind: "failed"; itemId: string; error: DisTubeError }>;

/** The private token an attached queue presents to the voice's track controls. */
export interface TrackOwner {
  onTrackStarted(itemId: string): void;
  onTrackOutcome(outcome: TrackOutcome): void;
}

export type TrackAcceptance = Readonly<{ kind: "accepted"; started: Promise<void> }>;

type VoicePhase = "open" | "fenced" | "released";

interface TrackRecord {
  /** Unique per play; what the Player correlates outcomes with, so a reused caller `itemId` cannot alias tracks. */
  readonly requestId: string;
  /** The caller's public identity, carried on `voice.track.*` events and owner outcomes. */
  readonly itemId?: string;
  readonly owner?: TrackOwner;
  readonly resource: OwnedPlaybackResource;
  phase: "accepted" | "activating" | "active" | "terminal";
  started?: true;
  /** A terminal connection loss reports an already-started track before queue deletion. */
  published?: true;
  backend?: Player;
  completion?: Promise<void>;
  /** A Player outcome reported before the start acknowledgement; published right after `voice.track.started`. */
  ended?: Readonly<{ outcome: TrackOutcome; notifyOwner: boolean }>;
  /** Cancelled by stop, detach or fence before the backend acknowledged; the late acknowledgement is dropped. */
  cancelled?: true;
}

const DEFAULT_VOLUME = 100;

/**
 * One guild's voice presence.
 *
 * DisTubeVoice owns the session, the long-lived Player, the active track and the connection-lifetime
 * settings. A DisTubeQueue attaches to drive the track controls; nothing else may while it is attached.
 */
export class VoiceImpl<Target = VoiceChannelTarget> {
  readonly #facade: DisTubeVoice<Target>;
  readonly #session: VoiceSession;
  readonly #engine: Engine;
  readonly #events: DisTubeEventEmitter<Target>;
  readonly #onTerminal: (error?: Error) => void;
  readonly #requestMove: (channelId: string) => Promise<void>;
  readonly #requestLeave: () => Promise<void>;
  readonly #report: (error: Error, stage: string) => void;
  readonly #sessionUnsubscribe: () => void;
  readonly #capabilities: PlaybackCapabilities;
  readonly #work = new TrackedWork();
  /** Retired backend completions remain terminal work even after their ordinary lane slot settles. */
  readonly #retirements: Promise<void>[] = [];
  #phase: VoicePhase = "open";
  #channelId: string;
  #volume = DEFAULT_VOLUME;
  #entries: readonly FilterEntry[] = NO_FILTERS;
  #playerTail: Promise<void> = Promise.resolve();
  #player?: Player;
  #playerUnsubscribe?: () => void;
  /** Whether committed settings were pushed onto the current Player. */
  #restored = false;
  #creation?: Promise<Player>;
  #attached?: TrackOwner;
  #track?: TrackRecord;
  readonly #accepted = new Set<TrackRecord>();
  /** Monotonic per-voice track sequence; makes every backend request ID unique even when a caller reuses an itemId. */
  #sequence = 0;
  #releasePromise?: Promise<void>;
  #fencedStop?: Promise<void>;

  /** @internal */
  constructor(
    session: VoiceSession,
    engine: Engine,
    events: DisTubeEventEmitter<Target>,
    onTerminal: (error?: Error) => void,
    requestMove: (channelId: string) => Promise<void>,
    requestLeave: () => Promise<void>,
    report: (error: Error, stage: string) => void,
    normalizeTarget: (target: Target) => VoiceTarget,
  ) {
    this.#session = session;
    this.#channelId = session.channelId;
    this.#engine = engine;
    this.#events = events;
    this.#onTerminal = onTerminal;
    this.#requestMove = requestMove;
    this.#requestLeave = requestLeave;
    this.#report = report;
    this.#capabilities = Object.freeze({
      seek: engine.capabilities.seek,
      resourceKinds: Object.freeze([...engine.accepts]),
      encodedFormats: Object.freeze([...(engine.encodedFormats ?? [])]),
    });
    this.#sessionUnsubscribe = session.subscribe(event => this.#onSessionEvent(event));
    const self = this;
    const filters = createFilterManager(
      engine,
      () => self.#entries,
      change => self.commitFilters(change),
    );
    const facade: DisTubeVoice<Target> = {
      get guildId(): string {
        return self.guildId;
      },
      get channelId(): string {
        return self.channelId;
      },
      get volume(): number {
        return self.#volume;
      },
      // Voice state is read through the session; the voice keeps no copy.
      get selfDeaf(): boolean {
        return self.#session.selfDeaf;
      },
      get selfMute(): boolean {
        return self.#session.selfMute;
      },
      filters,
      capabilities: this.#capabilities,
      get seekable(): boolean {
        return self.seekable;
      },
      get position(): number {
        return self.position;
      },
      play: (resource, options) => self.play(resource, options),
      stop: () => self.stop(),
      pause: () => self.pause(),
      resume: () => self.resume(),
      seek: seconds => self.seek(seconds),
      move: async (channel: Target): Promise<void> => {
        const target = normalizeTarget(channel);
        if (target.guildId !== self.guildId)
          throw new DisTubeError("INVALID_ARGUMENT", "Cannot move voice to another guild");
        await self.#requestMove(target.channelId);
      },
      leave: () => self.#requestLeave(),
      setVolume: percent => self.setVolume(percent),
      setSelfDeaf: enabled => self.setSelfDeaf(enabled),
      setSelfMute: enabled => self.setSelfMute(enabled),
    };
    Object.freeze(facade);
    this.#facade = facade;
  }

  /** Package-private public view; the implementation never crosses the package boundary. */
  get facade(): DisTubeVoice<Target> {
    return this.#facade;
  }

  get guildId(): string {
    return this.#session.guildId;
  }

  get channelId(): string {
    return this.#channelId;
  }

  get released(): boolean {
    return this.#phase === "released";
  }

  get position(): number {
    if (this.#track?.phase !== "active") return 0;
    const seconds = this.#player?.position ?? 0;
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  }

  get seekable(): boolean {
    return (
      this.#track?.phase === "active" &&
      this.#engine.capabilities.seek &&
      isPlaybackResourceSeekable(this.#track.resource.resource)
    );
  }

  // Queue attachment: one owner at a time, cleared synchronously so a replacement cannot inherit a track.

  attach(owner: TrackOwner): void {
    this.#assertOpen();
    if (this.#attached && this.#attached !== owner)
      throw new DisTubeError(ErrorCode.QUEUE_FAILED, "DisTubeVoice already has an attached queue");
    this.#attached = owner;
  }

  /** Detaches synchronously and joins only tracks accepted from this exact owner. */
  detach(owner: TrackOwner): Promise<void> {
    if (this.#attached !== owner) return Promise.resolve();
    this.#attached = undefined;
    const tracks = [...this.#accepted].filter(track => track.owner === owner);
    return this.#stopTracks(tracks);
  }

  assertResourceCompatible(resource: PlaybackResource): void {
    assertPlaybackResourceCompatible(resource, this.#engine);
  }

  // Track controls. Public callers pass no owner; the attached queue passes itself.

  play(resource: PlaybackResource, options: PlayTrackOptions = {}): Promise<void> {
    let owned: OwnedPlaybackResource;
    try {
      owned = consumePlaybackResource(resource);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    try {
      return this.acceptTrack(owned, options).started;
    } catch (error: unknown) {
      const context = resourceErrorContext(owned.resource);
      const failure = asError(error, context);
      return owned.dispose().then(
        () => Promise.reject(failure),
        cleanup =>
          Promise.reject(
            new DisTubeError(
              failure instanceof DisTubeError ? failure.code : ErrorCode.VOICE_FAILED,
              "Playback was rejected and cleanup failed",
              {
                cause: new AggregateError([failure, asError(cleanup, context)], "Playback rejection cleanup failures"),
              },
            ),
          ),
      );
    }
  }

  /** Synchronously transfers an already-consumed queue resource to one exact voice track. */
  acceptTrack(resource: OwnedPlaybackResource, options: PlayTrackOptions, owner?: TrackOwner): TrackAcceptance {
    this.#assertOpen();
    this.#assertOwner(owner);
    this.assertResourceCompatible(resource.resource);
    if (
      !options ||
      typeof options !== "object" ||
      Object.keys(options).some(key => key !== "itemId") ||
      (options.itemId !== undefined && (typeof options.itemId !== "string" || !options.itemId.trim()))
    ) {
      throw new DisTubeError("INVALID_ARGUMENT", "Invalid track options");
    }
    const track: TrackRecord = {
      requestId: `${options.itemId ?? "direct"}#${++this.#sequence}`,
      ...(options.itemId === undefined ? {} : { itemId: options.itemId }),
      ...(owner ? { owner } : {}),
      resource,
      phase: "accepted",
    };
    this.#accepted.add(track);
    const creation = this.#ensurePlayer();
    const activation = this.#enqueue(async () => {
      try {
        this.#assertTrack(track);
        const previous = this.#track;
        if (previous) {
          try {
            await this.#detachBackend(previous);
            await this.#completeTrack(previous, { kind: "finished", itemId: this.#publicId(previous) }, true);
          } catch (error: unknown) {
            const failure = asTrackError(error, previous);
            try {
              await this.#completeTrack(
                previous,
                {
                  kind: "failed",
                  itemId: this.#publicId(previous),
                  error: asTrackFailure("Player failed to stop the previous track", failure, previous),
                },
                true,
              );
            } catch (cleanup: unknown) {
              throw new DisTubeError("VOICE_FAILED", "Previous track stop and cleanup failed", {
                cause: new AggregateError([failure, asTrackError(cleanup, previous)], "Previous track failures"),
              });
            }
            throw failure;
          }
        }
        const player = await creation;
        this.#assertTrack(track);
        this.#assertLive(player, owner);
        await this.#restore(player);
        this.#assertTrack(track);
        this.#assertLive(player, owner);
        this.#track = track;
        track.phase = "activating";
        track.backend = player;
        await player.play({ itemId: track.requestId, resource: resource.resource });
        this.#assertTrack(track);
        track.phase = "active";
        track.started = true;
        this.#emitTrack("voice.track.started", track);
        // Private delivery establishes the queue start before any buffered terminal outcome.
        owner?.onTrackStarted(this.#publicId(track));
        if (track.ended) {
          this.#take(track);
          track.backend = undefined;
          await this.#completeTrack(track, track.ended.outcome, track.ended.notifyOwner);
        }
      } catch (error: unknown) {
        const failure = asTrackError(error, track);
        this.#take(track);
        try {
          await this.#detachBackend(track);
        } catch (cleanup: unknown) {
          throw new DisTubeError("VOICE_FAILED", "Playback start and stop failed", {
            cause: new AggregateError([failure, asTrackError(cleanup, track)], "Playback failures"),
          });
        }
        throw failure;
      }
    });
    const started = (async () => {
      try {
        await activation;
      } catch (error: unknown) {
        const failure = asTrackError(error, track);
        try {
          await this.#completeTrack(track, { kind: "finished", itemId: this.#publicId(track) }, false);
        } catch (cleanup: unknown) {
          throw new DisTubeError("VOICE_FAILED", "Playback start and cleanup failed", {
            cause: new AggregateError([failure, asTrackError(cleanup, track)], "Playback failures"),
          });
        }
        throw asTrackFailure("Player failed to start the track", failure, track);
      }
    })();
    // The activation and resource cleanup are tracked separately. A rejected start is the caller's
    // outcome, not a terminal cleanup failure, but terminal callers must still join its handling.
    void this.#work.start(() =>
      started.then(
        () => undefined,
        () => undefined,
      ),
    );
    // Ordinary start rejection belongs to the caller, not terminal cleanup's failure list.
    return Object.freeze({ kind: "accepted", started });
  }

  stop(owner?: TrackOwner): Promise<void> {
    try {
      this.#assertOpen();
      this.#assertOwner(owner);
      const tracks = [...this.#accepted].filter(track => track.owner === owner && track.phase !== "terminal");
      if (tracks.length === 0) throw this.#noTrack();
      return this.#stopTracks(tracks);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  /** Captures identity now, before another queued start can replace it. */
  endTrack(itemId: string, owner: TrackOwner): Promise<void> {
    return this.#stopTracks([...this.#accepted].filter(track => track.owner === owner && track.itemId === itemId));
  }

  #stopTracks(tracks: readonly TrackRecord[]): Promise<void> {
    for (const track of tracks) {
      if (!track.started) track.cancelled = true;
      this.#take(track);
    }
    let stopping!: Promise<void>;
    void this.#work.start(() => {
      stopping = (async () => {
        const failures: Error[] = [];
        for (const track of tracks) {
          try {
            await this.#enqueue(() => this.#detachBackend(track));
          } catch (error: unknown) {
            failures.push(asTrackError(error, track));
          }
          try {
            await this.#completeTrack(track, { kind: "finished", itemId: this.#publicId(track) }, false);
          } catch (error: unknown) {
            failures.push(asTrackError(error, track));
          }
        }
        if (failures.length)
          throw new DisTubeError("VOICE_FAILED", "Player failed to stop the track", {
            cause: new AggregateError(failures, "Track stop failures"),
          });
      })();
      // A terminal caller owns this failure through the returned promise. Registration here joins
      // native cessation and resource cleanup without duplicating the failure in TrackedWork.
      return stopping.then(
        () => undefined,
        () => undefined,
      );
    });
    return stopping;
  }

  #assertTrack(track: TrackRecord): void {
    this.#assertOpen();
    this.#assertOwner(track.owner);
    if (track.cancelled) throw new DisTubeError("INVALID_STATE", "Track was cancelled before it started");
  }

  async #detachBackend(track: TrackRecord): Promise<void> {
    this.#take(track);
    const player = track.backend;
    track.backend = undefined;
    if (!player) return;
    try {
      await player.stopTrack();
    } catch (error: unknown) {
      // A failed stop does not prove the backend released its borrowed input. Retire it before
      // source cleanup and let the next track create a fresh Player.
      const retired = this.#takePlayer(player, track);
      if (retired) {
        try {
          await this.#callPlayerRelease(retired);
        } catch (cleanup: unknown) {
          throw new DisTubeError("VOICE_FAILED", "Player stop and release failed", {
            cause: new AggregateError(
              [asTrackError(error, track), asTrackError(cleanup, track)],
              "Player retirement failures",
            ),
          });
        }
      }
      throw asTrackError(error, track);
    }
  }

  pause(owner?: TrackOwner): Promise<void> {
    return this.#trackControl(owner, player => player.pause());
  }

  resume(owner?: TrackOwner): Promise<void> {
    return this.#trackControl(owner, player => player.resume());
  }

  seek(seconds: number, owner?: TrackOwner): Promise<void> {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
      return Promise.reject(new DisTubeError("INVALID_ARGUMENT", "Seek seconds must be non-negative"));
    return this.#trackControl(owner, async player => {
      if (!this.#engine.capabilities.seek) throw new DisTubeError("UNSUPPORTED", "Engine does not support seeking");
      if (!this.#track || !isPlaybackResourceSeekable(this.#track.resource.resource)) {
        throw new DisTubeError("UNSUPPORTED", "Active playback resource is not seekable");
      }
      await player.seek(seconds);
    });
  }

  // Connection-lifetime settings.

  /** Commits a volume change only after its Player effect succeeds; serialized on the Player lane. */
  async setVolume(requested: number): Promise<void> {
    this.#assertOpen();
    if (typeof requested !== "number" || !Number.isFinite(requested) || requested < 0 || requested > 100) {
      throw new DisTubeError("INVALID_ARGUMENT", "volume must be finite between 0 and 100");
    }
    if (!this.#player) {
      // No Player yet: the value is committed state that the next Player restores at activation.
      this.#volume = requested;
      return;
    }
    try {
      await this.#enqueue(async () => {
        this.#assertOpen();
        // A terminal outcome can retire the Player while this request waits in its lane. The
        // value still belongs to DisTubeVoice, so retain it for the Player that eventually succeeds it.
        if (this.#player) await this.#player.setVolume(requested);
        this.#volume = requested;
      });
    } catch (error: unknown) {
      throw asDisTubeError(
        ErrorCode.VOICE_FAILED,
        "Player failed to set volume",
        error,
        this.#track ? resourceErrorContext(this.#track.resource.resource) : undefined,
      );
    }
  }

  /** Folds `change` onto the committed entries in lane order, renders once, and commits after acknowledgement. */
  async commitFilters(change: FilterChange): Promise<void> {
    this.#assertOpen();
    try {
      await this.#enqueue(async () => {
        this.#assertOpen();
        const entries = change(this.#entries);
        if (this.#player) await this.#player.setFilters(entries);
        this.#entries = entries;
      });
    } catch (error: unknown) {
      throw asDisTubeError(
        ErrorCode.VOICE_FAILED,
        "Player failed to render filters",
        error,
        this.#track ? resourceErrorContext(this.#track.resource.resource) : undefined,
      );
    }
  }

  async setSelfDeaf(enabled: boolean): Promise<void> {
    await this.#setVoiceState("selfDeaf", enabled);
  }

  async setSelfMute(enabled: boolean): Promise<void> {
    await this.#setVoiceState("selfMute", enabled);
  }

  /** Moves the session only after VoiceManager admits this operation to its slot lane. */
  async move(channelId: string): Promise<void> {
    this.#assertOpen();
    if (this.#channelId === channelId) return;
    try {
      await this.#session.join(channelId);
      this.#channelId = channelId;
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to move the voice session", error);
    }
  }

  // Lifetime.

  /** Fences track work immediately and ends the active track. Session release is owned by the terminal caller. */
  fence(error?: Error): void {
    if (this.#phase !== "open") return;
    this.#phase = "fenced";
    if (error) {
      for (const track of this.#accepted) {
        if (!track.started || track.published) continue;
        track.published = true;
        this.#emitTrack(
          "voice.track.failed",
          track,
          asTrackFailure("Voice connection was lost during playback", error, track),
        );
      }
    }
    this.#fencedStop = this.#stopTracks([...this.#accepted]);
    void this.#fencedStop.catch(error => this.#report(asError(error), "voice.track.stop"));
  }

  /** Releases the session after every already-accepted Player operation and late Player creation settle. */
  release(): Promise<void> {
    this.#releasePromise ??= this.#performRelease();
    return this.#releasePromise;
  }

  async #performRelease(): Promise<void> {
    const activeTrack = this.#track;
    this.fence();
    const playerTail = this.#playerTail;
    let terminalFailure: DisTubeError | undefined;
    this.#work.start(async () => {
      await playerTail;
      const failures: Error[] = [];
      try {
        await this.#fencedStop;
      } catch (error: unknown) {
        failures.push(asError(error));
      }
      const player = this.#takePlayer(undefined, activeTrack);
      if (player) this.#rememberRetirement(this.#callPlayerRelease(player), activeTrack);
      failures.push(...(await this.#joinRetirements()));
      try {
        await this.#session.release();
      } catch (error: unknown) {
        failures.push(asError(error));
      } finally {
        try {
          this.#sessionUnsubscribe();
        } catch (error: unknown) {
          failures.push(asError(error));
        }
      }
      terminalFailure = cleanupFailure(
        ErrorCode.VOICE_FAILED,
        "DisTubeVoice cleanup failed",
        failures,
        "DisTubeVoice terminal cleanup failures",
      );
    });
    const failures = await this.#work.settle();
    this.#phase = "released";
    if (terminalFailure && failures.length === 0) throw terminalFailure;
    const failure = cleanupFailure(
      ErrorCode.VOICE_FAILED,
      "DisTubeVoice cleanup failed",
      [...(terminalFailure ? [terminalFailure] : []), ...failures],
      "DisTubeVoice cleanup failures",
    );
    if (failure) throw failure;
  }

  // Internals.

  #trackControl(
    owner: TrackOwner | undefined,
    effect: (player: Player, track: TrackRecord) => Promise<void>,
  ): Promise<void> {
    try {
      this.#assertOpen();
      this.#assertOwner(owner);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return this.#enqueue(async () => {
      this.#assertOpen();
      this.#assertOwner(owner);
      const track = this.#track;
      const player = this.#player;
      if (track?.phase !== "active" || !player) throw this.#noTrack();
      try {
        await effect(player, track);
      } catch (error: unknown) {
        throw asTrackFailure("Player failed to apply the track control", error, track);
      }
    });
  }

  async #setVoiceState(setting: "selfDeaf" | "selfMute", enabled: boolean): Promise<void> {
    this.#assertOpen();
    if (typeof enabled !== "boolean") throw new DisTubeError("INVALID_ARGUMENT", `${setting} must be a boolean`);
    try {
      if (setting === "selfDeaf") await this.#session.setSelfDeaf(enabled);
      else await this.#session.setSelfMute(enabled);
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, `Adapter failed to update ${setting}`, error);
    }
  }

  /** Pushes committed settings onto a fresh Player once, before its first track. */
  async #restore(player: Player): Promise<void> {
    if (this.#restored || this.#player !== player) return;
    await player.setVolume(this.#volume);
    if (this.#entries.length > 0) await player.setFilters(this.#entries);
    this.#restored = true;
  }

  #ensurePlayer(): Promise<Player> {
    if (this.#player) return Promise.resolve(this.#player);
    this.#creation ??= this.#enqueue(async () => {
      let owned: Player | undefined;
      try {
        const player = await this.#engine.createPlayer(this.#session);
        owned = player;
        const unsubscribe = player.subscribe(event => this.#onPlayerEvent(player, event));
        this.#player = player;
        this.#playerUnsubscribe = unsubscribe;
        this.#restored = false;
        owned = undefined;
        return player;
      } catch (error: unknown) {
        if (owned) {
          try {
            await owned.release();
          } catch (cleanup: unknown) {
            throw new DisTubeError("VOICE_FAILED", "Player construction cleanup failed", {
              cause: new AggregateError([asError(error), asError(cleanup)], "Player construction failures"),
            });
          }
        }
        throw asDisTubeError(ErrorCode.VOICE_FAILED, "Engine failed to create Player", error);
      }
    });
    const creation = this.#creation;
    void creation
      .finally(() => {
        if (this.#creation === creation) this.#creation = undefined;
      })
      .catch(() => undefined);
    return creation;
  }

  #onPlayerEvent(player: Player, event: PlayerEvent): void {
    if (this.#phase !== "open" || this.#player !== player) return;
    const track = this.#track;
    const terminal = event.type === "terminal" || (event.type === "failed" && event.terminal === true);
    if (terminal) {
      // A terminal Player must not serve a later play, and whatever it was playing cannot continue: the
      // current track fails with the backend's cause even when the event names another (stale) track.
      this.#retirePlayer(player, track);
      if (track && (event.type === "terminal" || event.itemId !== track.requestId)) {
        this.#end(
          track,
          {
            kind: "failed",
            itemId: this.#publicId(track),
            error: asTrackFailure("Player terminated during the track", event.error, track),
          },
          true,
        );
        return;
      }
    }
    if (event.type === "terminal" || !track || track.requestId !== event.itemId) return;
    this.#end(
      track,
      event.type === "finished"
        ? { kind: "finished", itemId: this.#publicId(track) }
        : {
            kind: "failed",
            itemId: this.#publicId(track),
            error: asTrackFailure("Player reported playback failure", event.error, track),
          },
      true,
    );
  }

  /** Keeps an early-ended track cancellable until acknowledgement; only its first outcome is published. */
  #end(track: TrackRecord, outcome: TrackOutcome, notifyOwner: boolean): void {
    if (track.phase === "activating") {
      track.ended ??= Object.freeze({ outcome, notifyOwner });
      return;
    }
    this.#take(track);
    track.backend = undefined;
    void this.#work
      .start(() => this.#completeTrack(track, outcome, notifyOwner))
      .catch(error => this.#report(asTrackError(error, track), "voice.track.cleanup"));
  }

  #completeTrack(track: TrackRecord, outcome: TrackOutcome, notifyOwner: boolean): Promise<void> {
    track.completion ??= this.#work.start(async () => {
      track.phase = "terminal";
      try {
        await track.resource.dispose();
      } finally {
        this.#accepted.delete(track);
        if (track.started && !track.published) this.#publish(track, outcome, notifyOwner);
      }
    });
    return track.completion;
  }

  #publicId(track: TrackRecord): string {
    return track.itemId ?? track.requestId;
  }

  #take(track: TrackRecord): void {
    if (this.#track === track) this.#track = undefined;
  }

  #publish(track: TrackRecord, outcome: TrackOutcome, notifyOwner: boolean): void {
    if (outcome.kind === "finished") this.#emitTrack("voice.track.finished", track);
    else this.#emitTrack("voice.track.failed", track, outcome.error);
    if (!notifyOwner || !track.owner || track.owner !== this.#attached) return;
    try {
      track.owner.onTrackOutcome(outcome);
    } catch (error: unknown) {
      this.#report(asTrackError(error, track), "voice.track.outcome");
    }
  }

  #emitTrack(
    name: "voice.track.started" | "voice.track.finished" | "voice.track.failed",
    track: TrackRecord,
    error?: DisTubeError,
  ): void {
    this.#events.emit(
      name,
      Object.freeze({
        guildId: this.guildId,
        voice: this.#facade,
        timestamp: Date.now(),
        ...(track.itemId === undefined ? {} : { itemId: track.itemId }),
        ...(error ? { error } : {}),
      }) as never,
    );
  }

  #onSessionEvent(event: VoiceSessionEvent): void {
    if (this.#phase !== "open") return;
    if (event.type === "disconnected") {
      this.fence(event.error ?? new Error("Voice session disconnected"));
      this.#onTerminal(event.error);
      return;
    }
    this.#channelId = event.channelId;
    this.#refreshGateway(event.gateway);
  }

  #refreshGateway(gateway: VoiceGatewayData): void {
    const player = this.#player;
    const track = this.#track;
    if (!player?.updateVoiceGateway) return;
    void this.#enqueue(async () => {
      if (this.#phase !== "open" || this.#player !== player || !player.updateVoiceGateway) return;
      await player.updateVoiceGateway(gateway);
    }).catch(error => this.#report(track ? asTrackError(error, track) : asError(error), "voice.gateway.refresh"));
  }

  #retirePlayer(player: Player, track?: TrackRecord): void {
    const retiring = this.#takePlayer(player, track);
    if (!retiring) return;
    const result = this.#playerTail.then(() => retiring.release());
    this.#playerTail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#rememberRetirement(result, track);
  }

  #callPlayerRelease(player: Player): Promise<void> {
    try {
      return Promise.resolve(player.release());
    } catch (error: unknown) {
      return Promise.reject(asError(error));
    }
  }

  #rememberRetirement(completion: Promise<void>, track?: TrackRecord): void {
    const safe = completion.catch(error => Promise.reject(track ? asTrackError(error, track) : asError(error)));
    this.#retirements.push(safe);
    void safe.catch(error => this.#report(error, "voice.player.release"));
  }

  #joinRetirements(): Promise<Error[]> {
    let cursor = 0;
    return settleGrowing(() => {
      const completions = this.#retirements.slice(cursor);
      cursor += completions.length;
      return completions;
    });
  }

  #takePlayer(expected?: Player, track?: TrackRecord): Player | undefined {
    const player = this.#player;
    if (!player || (expected && player !== expected)) return undefined;
    this.#player = undefined;
    this.#restored = false;
    try {
      this.#playerUnsubscribe?.();
    } catch (error: unknown) {
      this.#rememberRetirement(Promise.reject(error), track);
    }
    this.#playerUnsubscribe = undefined;
    return player;
  }

  #enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    let result!: Promise<Value>;
    void this.#work.start(() => {
      result = this.#playerTail.then(operation);
      this.#playerTail = result.then(
        () => undefined,
        () => undefined,
      );
      // Effect failures belong to their caller. Track settlement here so release joins the effect
      // without reporting the same rejected operation as a second cleanup failure.
      return result.then(
        () => undefined,
        () => undefined,
      );
    });
    return result;
  }

  /** An attached queue excludes outside callers; a detached queue's queued work is stale, not promoted. */
  #assertOwner(owner: TrackOwner | undefined): void {
    if (owner ? owner !== this.#attached : this.#attached !== undefined) {
      throw new DisTubeError("INVALID_STATE", "DisTubeVoice track controls belong to the attached DisTubeQueue");
    }
  }

  #assertOpen(): void {
    if (this.#phase !== "open") throw new DisTubeError("INVALID_STATE", "DisTubeVoice is no longer connected");
  }

  /** Rechecked after every await on the play path: still open, still this owner's turn, Player not retired. */
  #assertLive(player: Player, owner: TrackOwner | undefined): void {
    this.#assertOpen();
    this.#assertOwner(owner);
    if (this.#player !== player) throw new DisTubeError("INVALID_STATE", "Player was retired before the track started");
  }

  #noTrack(): DisTubeError {
    return new DisTubeError("INVALID_STATE", "DisTubeVoice has no active track");
  }
}

function asTrackError(error: unknown, track: TrackRecord): Error {
  return asError(error, resourceErrorContext(track.resource.resource));
}

function asTrackFailure(message: string, error: unknown, track: TrackRecord): DisTubeError {
  return asDisTubeError(ErrorCode.VOICE_FAILED, message, error, resourceErrorContext(track.resource.resource));
}
