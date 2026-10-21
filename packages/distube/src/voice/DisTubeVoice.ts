import type {
  Engine,
  FilterEntry,
  PlaybackResource,
  Player,
  TrackEnd,
  VoiceSession,
  VoiceSessionEvent,
  VoiceTarget,
} from "../contracts";
import { abortError, DisTubeError, ErrorCode, requireBoolean, throwIfAborted, toDisTubeError } from "../errors";
import type { DisTubeEvents } from "../events";
import { disposeResource } from "../plugins";
import { FilterManager, NO_FILTERS } from "./filters";
import type { VoiceChannelTarget } from "./target";

export interface PlayTrackOptions {
  /** Aborting before the track starts rejects `ABORTED`; aborting after ends it `stopped`. */
  readonly signal?: AbortSignal;
  /** Called once when audio starts. */
  readonly onStart?: () => void;
}

export interface VoiceContext<Target> {
  readonly session: VoiceSession;
  readonly engine: Engine;
  readonly events: DisTubeEvents<Target>;
  readonly normalizeTarget: (target: Target) => VoiceTarget;
  readonly leave: () => Promise<void>;
  readonly disconnected: (error?: Error) => void;
}

interface Track {
  readonly resource: PlaybackResource;
  readonly controller: AbortController;
  readonly replaced: PromiseWithResolvers<TrackEnd>;
  readonly disposed: PromiseWithResolvers<void>;
  callerSettled: Promise<void>;
  player?: Player;
  started: boolean;
  superseded: boolean;
}

const STOPPED: TrackEnd = Object.freeze({ reason: "stopped" });
const REPLACED: TrackEnd = Object.freeze({ reason: "replaced" });
const DEFAULT_VOLUME = 100;
const MIN_BITRATE = 6000;
const MAX_BITRATE = 510_000;

export let closeVoice: <Target>(voice: DisTubeVoice<Target>, error?: DisTubeError) => Promise<void>;

/**
 * One guild's voice connection, its lazily created Player and the settings that outlive tracks.
 *
 * The last `play` wins: it replaces the current track, whoever started it, and the replaced call settles
 * `{ reason: "replaced" }`.
 */
export class DisTubeVoice<Target = VoiceChannelTarget> {
  readonly filters: FilterManager;
  readonly #context: VoiceContext<Target>;
  readonly #unsubscribe: () => void;
  #volume = DEFAULT_VOLUME;
  #bitrate: number | "auto" = "auto";
  #entries: readonly FilterEntry[] = NO_FILTERS;
  #paused = false;
  #channelId: string;
  #player?: Promise<Player>;
  #settings: Promise<unknown> = Promise.resolve();
  #track?: Track;
  #closed = false;
  #closing?: Promise<void>;

  static {
    closeVoice = (voice, error) => voice.#close(error);
  }

  constructor(context: VoiceContext<Target>) {
    this.#context = context;
    this.#channelId = context.session.channelId;
    this.filters = new FilterManager(
      context.engine,
      () => this.#entries,
      change =>
        this.#setting("Player failed to render filters", async player => {
          const entries = change(this.#entries);
          await player?.setFilters(entries);
          this.#entries = entries;
        }),
    );
    this.#unsubscribe = context.session.subscribe(event => this.#onSessionEvent(event));
  }

  get guildId(): string {
    return this.#context.session.guildId;
  }

  /** The last channel the platform acknowledged. */
  get channelId(): string {
    return this.#channelId;
  }

  get volume(): number {
    return this.#volume;
  }

  /** The target encode bitrate in bits per second, or `"auto"` to follow the channel. */
  get bitrate(): number | "auto" {
    return this.#bitrate;
  }

  get selfDeaf(): boolean {
    return this.#context.session.selfDeaf;
  }

  get selfMute(): boolean {
    return this.#context.session.selfMute;
  }

  /** The Player's pause intent, which carries over to the next track. */
  get paused(): boolean {
    return this.#paused;
  }

  /** Elapsed seconds of the active track, or `0`. */
  get position(): number {
    return this.#track?.player?.position ?? 0;
  }

  /**
   * Plays `resource`, replacing the current track, and settles with how it ended. Disposes `resource` once the
   * Player stops reading it; a replaced call settles without waiting for that disposal.
   */
  play(resource: PlaybackResource, options: PlayTrackOptions = {}): Promise<TrackEnd> {
    const track: Track = {
      resource,
      controller: new AbortController(),
      replaced: Promise.withResolvers(),
      disposed: Promise.withResolvers(),
      callerSettled: Promise.resolve(),
      started: false,
      superseded: false,
    };
    const result = this.#play(track, options);
    track.callerSettled = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #play(track: Track, { signal, onStart }: PlayTrackOptions): Promise<TrackEnd> {
    const previous = this.#track;
    let reading: Promise<unknown> = Promise.resolve();
    let end: TrackEnd | undefined;
    try {
      this.#assertOpen();
      throwIfAborted(signal);
      this.#track = track;
      if (previous) {
        previous.superseded = true;
        previous.replaced.resolve(REPLACED);
      }
      const player = await this.#ensurePlayer();
      await previous?.callerSettled;
      end = this.#interruption(track, signal);
      if (end) return end;
      track.player = player;
      const trackSignal = signal ? AbortSignal.any([signal, track.controller.signal]) : track.controller.signal;
      const playing = player.play(track.resource, {
        signal: trackSignal,
        onStart: () => this.#started(track, onStart),
      });
      reading = playing.catch(() => undefined);
      const outcome = await Promise.race([playing, track.replaced.promise]);
      end = this.#interruption(track, signal) ?? outcome;
      return end;
    } catch (error: unknown) {
      end = this.#interruption(track, signal);
      if (end) return end;
      throw toDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to play the track", error);
    } finally {
      if (this.#track === track) this.#track = undefined;
      const disposal = reading
        .then(() => disposeResource(track.resource))
        .catch((error: unknown) => this.#report("voice.resource.dispose", error))
        .then(() => track.disposed.resolve());
      if (end !== REPLACED) await disposal;
    }
  }

  /** Ends the active track as `stopped` and resolves once it has ended. */
  async stop(): Promise<void> {
    const track = this.#activeTrack(false);
    const player = track.player;
    if (player) await this.#call("Player failed to stop the track", () => player.stopTrack());
    else track.controller.abort(STOPPED);
    await track.disposed.promise;
  }

  async pause(): Promise<void> {
    await this.#setPaused(true);
  }

  async resume(): Promise<void> {
    await this.#setPaused(false);
  }

  async seek(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Seek seconds must be non-negative");
    const track = this.#activeTrack(true);
    if (!seekable(track.resource)) throw new DisTubeError(ErrorCode.UNSUPPORTED, "The current track cannot seek");
    const player = track.player as Player;
    await this.#call("Player failed to seek", () => player.seek(seconds));
  }

  /** Percentage from 0 to 100; committed once the Player applies it. */
  async setVolume(percent: number): Promise<void> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Volume must be between 0 and 100");
    await this.#setting("Player failed to set volume", async player => {
      await player?.setVolume(percent);
      this.#volume = percent;
    });
  }

  /** 6000 to 510000 bits per second, or `"auto"` to follow the channel. A live Player without bitrate control rejects a number `UNSUPPORTED`. */
  async setBitrate(bitrate: number | "auto"): Promise<void> {
    if (bitrate !== "auto" && (!Number.isInteger(bitrate) || bitrate < MIN_BITRATE || bitrate > MAX_BITRATE))
      throw new DisTubeError(
        ErrorCode.INVALID_ARGUMENT,
        `Bitrate must be an integer from ${MIN_BITRATE} to ${MAX_BITRATE} or "auto"`,
      );
    await this.#setting("Player failed to set bitrate", async player => {
      if (player) await applyBitrate(player, bitrate);
      this.#bitrate = bitrate;
    });
  }

  async setSelfDeaf(enabled: boolean): Promise<void> {
    requireBoolean(enabled, "selfDeaf");
    await this.#join(this.channelId, { selfDeaf: enabled });
  }

  async setSelfMute(enabled: boolean): Promise<void> {
    requireBoolean(enabled, "selfMute");
    await this.#join(this.channelId, { selfMute: enabled });
  }

  async move(channel: Target): Promise<void> {
    this.#assertOpen();
    const target = this.#context.normalizeTarget(channel);
    if (target.guildId !== this.guildId)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Cannot move voice to another guild");
    if (target.channelId !== this.channelId) await this.#join(target.channelId);
  }

  /** Deletes the guild queue, then releases the Player and the session. */
  leave(): Promise<void> {
    return this.#context.leave();
  }

  async #join(channelId: string, state?: { selfDeaf?: boolean; selfMute?: boolean }): Promise<void> {
    this.#assertOpen();
    await this.#call("Adapter failed to update the voice session", () =>
      state ? this.#context.session.join(channelId, state) : this.#context.session.join(channelId),
    );
    this.#channelId = channelId;
  }

  #interruption(track: Track, signal: AbortSignal | undefined): TrackEnd | undefined {
    const { aborted, reason } = track.controller.signal;
    if (aborted && reason instanceof DisTubeError) throw reason;
    if (track.superseded) return REPLACED;
    if (signal?.aborted && !track.started) throw abortError(signal);
    return aborted || signal?.aborted ? STOPPED : undefined;
  }

  #started(track: Track, onStart: (() => void) | undefined): void {
    track.started = true;
    try {
      onStart?.();
    } catch (error: unknown) {
      this.#report("voice.track.start", error);
    }
  }

  #activeTrack(requirePlayer: boolean): Track {
    this.#assertOpen();
    const track = this.#track;
    if (!track || (requirePlayer && !track.player))
      throw new DisTubeError(ErrorCode.INVALID_STATE, "DisTubeVoice has no active track");
    return track;
  }

  async #setPaused(paused: boolean): Promise<void> {
    this.#activeTrack(true);
    await this.#serial(async () => {
      const player = this.#activeTrack(true).player as Player;
      if (this.#paused === paused) return;
      await this.#call(paused ? "Player failed to pause" : "Player failed to resume", () =>
        paused ? player.pause() : player.resume(),
      );
      this.#paused = paused;
    });
  }

  #ensurePlayer(): Promise<Player> {
    if (this.#player) return this.#player;
    const creation = this.#serial(async () => {
      const player = await this.#call("Engine failed to create a Player", () =>
        this.#context.engine.createPlayer(this.#context.session),
      );
      try {
        this.#assertOpen();
        await player.setVolume(this.#volume);
        if (this.#entries.length > 0) await player.setFilters(this.#entries);
        if (this.#bitrate !== "auto") await player.setBitrate?.(this.#bitrate);
        return player;
      } catch (error: unknown) {
        await player.release().catch((cleanup: unknown) => this.#report("voice.player.release", cleanup));
        throw toDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to restore voice settings", error);
      }
    });
    this.#player = creation;
    creation.catch(() => {
      if (this.#player === creation) this.#player = undefined;
    });
    return creation;
  }

  #setting(message: string, apply: (player: Player | undefined) => Promise<void>): Promise<void> {
    try {
      this.#assertOpen();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return this.#serial(async () => {
      const player = await this.#player?.catch(() => undefined);
      await this.#call(message, () => apply(player));
    });
  }

  #serial<Value>(work: () => Promise<Value>): Promise<Value> {
    const run = this.#settings.then(work);
    this.#settings = run.catch(() => undefined);
    return run;
  }

  async #call<Value>(message: string, operation: () => Promise<Value>): Promise<Value> {
    try {
      return await operation();
    } catch (error: unknown) {
      throw toDisTubeError(ErrorCode.VOICE_FAILED, message, error);
    }
  }

  #onSessionEvent(event: VoiceSessionEvent): void {
    if (this.#closed) return;
    if (event.type === "disconnected") {
      this.#context.disconnected(event.error);
      return;
    }
    this.#channelId = event.channelId;
    this.#serial(async () => {
      const player = await this.#player?.catch(() => undefined);
      await this.#call("Player failed to refresh the voice gateway", async () =>
        player?.updateVoiceGateway?.(event.gateway),
      );
    }).catch((error: unknown) => this.#report("voice.gateway", error));
  }

  #close(error?: DisTubeError): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#unsubscribe();
    const track = this.#track;
    track?.controller.abort(error ?? STOPPED);
    const player = this.#player;
    this.#closing = (async () => {
      const failures: unknown[] = [];
      await player?.then(
        active => active.release().catch((cleanup: unknown) => failures.push(cleanup)),
        () => undefined,
      );
      await track?.disposed.promise;
      await this.#context.session.release().catch((cleanup: unknown) => failures.push(cleanup));
      if (failures.length > 0) {
        throw new DisTubeError(ErrorCode.VOICE_FAILED, "DisTubeVoice cleanup failed", {
          cause: failures.length === 1 ? failures[0] : new AggregateError(failures, "DisTubeVoice cleanup failures"),
        });
      }
    })();
    return this.#closing;
  }

  #assertOpen(): void {
    if (this.#closed) throw new DisTubeError(ErrorCode.INVALID_STATE, "DisTubeVoice is no longer connected");
  }

  #report(stage: string, error: unknown): void {
    this.#context.events.report({ severity: "error", stage, message: `DisTubeVoice ${this.guildId}: ${stage}`, error });
  }
}

async function applyBitrate(player: Player, bitrate: number | "auto"): Promise<void> {
  if (player.setBitrate) await player.setBitrate(bitrate === "auto" ? undefined : bitrate);
  else if (bitrate !== "auto") throw new DisTubeError(ErrorCode.UNSUPPORTED, "Player cannot change the bitrate");
}

function seekable(resource: PlaybackResource): boolean {
  if (resource.kind === "url" || resource.kind === "encoded") return resource.seekable === true;
  return resource.kind !== "stream";
}
