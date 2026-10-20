import { asError, type FilterRegistry, playbackRequest, Track } from "@distube/voice-core/core";
import { DisTubeError } from "distube";
import type { FilterEntry, PlaybackRequest, Player, PlayerEvent } from "distube/integrations";
import type { VoiceConnection } from "eris";
import { ensureErisErrorSink, type NativeCurrent, observeStopPlaying, pacedOpusPackets } from "./native-playback";

/** Eris's 2 s default would end a track during a brief network stall. */
const VOICE_DATA_TIMEOUT_MS = 15_000;
/** The Track's packet duration, which Eris adds to `playTime` for every packet it sends. */
const FRAME_MS = 20;

/** One track the Player holds, from native hand-off to its single outcome. */
interface ActiveTrack {
  readonly itemId: string;
  readonly track: Track;
  /** The exact Eris current-stream object that plays this track. */
  readonly nativeCurrent: NativeCurrent;
  /** Whether the Track pushed its last packet, which makes the next native stop a natural completion. */
  ended: boolean;
}

/**
 * The long-lived playback backend for one connected Eris voice session.
 *
 * The Player outlives tracks and queues until release or terminal transport failure. Eris receives the
 * Track's Opus packets directly; volume, filters and seek apply to the running Track in place.
 */
export class ErisVoicePlayer implements Player {
  readonly #connection: VoiceConnection;
  readonly #filters: FilterRegistry;
  readonly #releaseTransport?: () => void;
  readonly #listeners = new Set<(event: PlayerEvent) => void>();
  /** Track opens and closes still running, which release joins before the transport goes. */
  readonly #pending = new Set<Promise<void>>();
  readonly #opening = new Set<AbortController>();
  #restoreStopPlaying?: () => void;
  #track?: ActiveTrack;
  /** The only pause authority this Player reads. Eris constructs its connection paused, so the
   * native flag starts `true` and must never be trusted for playback intent. */
  #pauseIntent = false;
  #volume = 100;
  #chain?: string;
  #terminal = false;
  #releasePromise?: Promise<void>;

  constructor(connection: VoiceConnection, filters: FilterRegistry, releaseTransport?: () => void) {
    this.#connection = connection;
    this.#filters = filters;
    this.#releaseTransport = releaseTransport;
    ensureErisErrorSink(connection);
    this.#restoreStopPlaying = observeStopPlaying(connection, this.#onNativeStop);
    connection.on("disconnect", this.#onDisconnect);
    connection.on("ready", this.#onReady);
  }

  get position(): number {
    return this.#track?.track.position ?? 0;
  }

  async play(value: PlaybackRequest): Promise<void> {
    this.#assertOpen();
    if (this.#track || this.#opening.size > 0) throw new Error("Eris Player already has active playback");
    const request = playbackRequest(value);
    const controller = new AbortController();
    this.#opening.add(controller);
    const opening = Track.open(request.resource, { volume: this.#volume, chain: this.#chain }, controller.signal);
    this.#join(opening.then(() => undefined));
    let track: Track;
    try {
      track = await opening;
    } finally {
      this.#opening.delete(controller);
    }
    if (this.#terminal || this.#track || controller.signal.aborted) {
      this.#join(track.close());
      this.#assertOpen();
      throw new Error("Eris Player track was superseded");
    }
    let nativeCurrent: NativeCurrent;
    try {
      nativeCurrent = this.#handOff(track);
    } catch (error: unknown) {
      this.#join(track.close());
      this.#connection.stopPlaying();
      throw error;
    }
    track.setPlayedCounter(() => nativeCurrent.playTime / FRAME_MS);
    const active: ActiveTrack = { itemId: request.itemId, track, nativeCurrent, ended: false };
    this.#track = active;
    this.#watch(active);
  }

  async pause(): Promise<void> {
    this.#assertOpen();
    if (!this.#track) throw new Error("Eris Player has no active playback");
    this.#pauseIntent = true;
    this.#connection.pause();
  }

  async resume(): Promise<void> {
    this.#assertOpen();
    if (!this.#track) throw new Error("Eris Player has no active playback");
    if (!this.#pauseIntent) return;
    this.#pauseIntent = false;
    this.#connection.resume();
  }

  /** Ends the active track, leaving the Player and its voice connection ready for the next one. */
  async stopTrack(): Promise<void> {
    this.#assertOpen();
    for (const controller of this.#opening) controller.abort();
    const active = this.#track;
    if (active) this.#endTrack(active);
  }

  async seek(seconds: number): Promise<void> {
    this.#assertOpen();
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new DisTubeError("INVALID_ARGUMENT", "seek position must be non-negative");
    const active = this.#track;
    if (!active) throw new DisTubeError("INVALID_STATE", "Player has no active track");
    await active.track.seek(seconds);
  }

  async setVolume(percent: number): Promise<void> {
    this.#assertOpen();
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) {
      throw new DisTubeError("INVALID_ARGUMENT", "volume must be a non-negative number");
    }
    this.#track?.track.setVolume(percent);
    this.#volume = percent;
  }

  async setFilters(entries: readonly FilterEntry[]): Promise<void> {
    this.#assertOpen();
    const chain = this.#filters.render(entries);
    if (chain === this.#chain) return;
    await this.#track?.track.setFilters(chain);
    this.#chain = chain;
  }

  release(): Promise<void> {
    this.#terminal = true;
    this.#releasePromise ??= this.#cleanup();
    return this.#releasePromise;
  }

  subscribe(listener: (event: PlayerEvent) => void): () => void {
    if (this.#terminal) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #join(work: Promise<void>): void {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.#pending.add(settled);
    void settled.then(() => this.#pending.delete(settled));
  }

  #handOff(track: Track): NativeCurrent {
    this.#connection.play(pacedOpusPackets(track.packets), {
      format: "opusPackets",
      frameDuration: FRAME_MS,
      voiceDataTimeout: VOICE_DATA_TIMEOUT_MS,
    });
    const current = this.#connection.current;
    if (!current) throw new Error("Eris voice connection could not start the track");
    if (this.#pauseIntent) this.#connection.pause();
    return current;
  }

  #watch(active: ActiveTrack): void {
    void active.track.outcome.then(outcome => {
      if (this.#terminal || this.#track !== active) return;
      if (outcome.type === "failed") this.#fail(active, outcome.error);
      else if (outcome.type === "ended") active.ended = true;
    });
  }

  #finish(active: ActiveTrack): void {
    if (this.#track !== active) return;
    this.#track = undefined;
    this.#join(active.track.close());
    this.#emit({ type: "finished", itemId: active.itemId });
  }

  /** Ends the track's audio without touching the Player, its listeners, or the connection. */
  #endTrack(active: ActiveTrack): void {
    if (this.#track !== active) return;
    this.#track = undefined;
    this.#connection.stopPlaying();
    this.#join(active.track.close());
  }

  /** Ends the track and reports it as failed; the Player stays usable for the next request. */
  #fail(active: ActiveTrack, error: Error): void {
    if (this.#track !== active) return;
    this.#endTrack(active);
    this.#emit({ type: "failed", itemId: active.itemId, error });
  }

  /**
   * Accepts Eris completion only for the exact native stream this active track started. Eris drains its
   * queue only after the Track's last packet, so a stop before then is Eris giving the track up.
   */
  readonly #onNativeStop = (current: NativeCurrent | undefined): void => {
    const active = this.#track;
    if (this.#terminal || !active || current !== active.nativeCurrent) return;
    // Eris stops playback while tearing a connection down, so a stop on a connection that is no
    // longer ready is the disconnect arriving rather than a finished track.
    if (!this.#connection.ready) return;
    if (active.ended) this.#finish(active);
    else this.#fail(active, new Error("Eris voice connection stopped the track before its input ended"));
  };

  /** Eris resumes right after it emits `ready` on a reconnect, so pause intent is reapplied once it has. */
  readonly #onReady = (): void => {
    queueMicrotask(() => {
      if (!this.#terminal && this.#pauseIntent) this.#connection.pause();
    });
  };

  readonly #onDisconnect = (error?: Error): void => {
    this.#retire(error ?? new Error("Eris voice connection was disconnected"));
  };

  /** Retires the Player with its session: no later playback, no later outcome, no leaked track. */
  #retire(error: Error): void {
    if (this.#terminal) return;
    const active = this.#track;
    const listeners = [...this.#listeners];
    this.#terminal = true;
    this.#releasePromise ??= this.#cleanup();
    if (!active) return;
    const outcome: PlayerEvent = { type: "failed", itemId: active.itemId, error, terminal: true };
    for (const listener of listeners) deliver(listener, outcome);
  }

  async #cleanup(): Promise<void> {
    for (const controller of this.#opening) controller.abort();
    const active = this.#track;
    this.#track = undefined;
    this.#listeners.clear();
    const failures: Error[] = [];
    const attempt = (step: () => void): void => {
      try {
        step();
      } catch (error: unknown) {
        failures.push(asError(error));
      }
    };
    attempt(() => this.#connection.off("disconnect", this.#onDisconnect));
    attempt(() => this.#connection.off("ready", this.#onReady));
    const restoreStopPlaying = this.#restoreStopPlaying;
    this.#restoreStopPlaying = undefined;
    attempt(() => restoreStopPlaying?.());
    attempt(() => this.#connection.stopPlaying());
    if (active) this.#join(active.track.close());
    // Voice must not release its session before every opened input has closed.
    while (this.#pending.size > 0) await Promise.all(this.#pending);
    attempt(() => this.#releaseTransport?.());
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Eris Player cleanup failures");
  }

  #assertOpen(): void {
    if (this.#terminal) throw new Error("Eris Player is retired");
  }

  #emit(event: PlayerEvent): void {
    if (this.#terminal) return;
    for (const listener of this.#listeners) deliver(listener, event);
  }
}

function deliver(listener: (event: PlayerEvent) => void, event: PlayerEvent): void {
  try {
    listener(event);
  } catch {
    // Player listeners are isolated; GuildQueue remains the state and diagnostic authority.
  }
}
