import type { AudioPlayer, AudioPlayerError, AudioResource, VoiceConnection } from "@discordjs/voice";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { DisTubeError } from "distube";
import type { FilterEntry, PlaybackRequest, Player, PlayerEvent } from "distube/integrations";
import { asError } from "./cleanup";
import type { FilterRegistry } from "./filters";
import { Track } from "./track";
import { playbackRequest } from "./validation";

/** How long a fresh track has to reach the audio player before the request gives up. */
const START_TIMEOUT_MS = 15_000;

const MAX_MISSED_FRAMES = 15_000 / 20;

/** States in which the audio player holds a resource without consuming it. */
const HELD_STATES: ReadonlySet<AudioPlayerStatus> = new Set([AudioPlayerStatus.Paused, AudioPlayerStatus.AutoPaused]);

/** One track the Player holds, from native hand-off to its single outcome. */
interface ActiveTrack {
  readonly itemId: string;
  readonly track: Track;
  readonly resource: AudioResource;
  /** Whether the audio player accepted the track, which is what makes a later end an item outcome. */
  started: boolean;
  /** Signals a matching early Idle transition while native startup is still settling. */
  readonly start: StartSignal;
  /** Natural completion needs both this resource's Idle transition and the Track's end of input. */
  idle: boolean;
  ended: boolean;
}

/** Coordinates native startup events for the track currently trying to start. */
interface StartSignal {
  complete(): void;
  fail(error: Error): void;
  readonly completed: Promise<void>;
  readonly failed: Promise<never>;
}

/**
 * The long-lived playback backend for one connected voice session.
 *
 * The Player outlives tracks and queues until release or terminal transport failure. Volume and filters
 * live here and apply to the running Track in place.
 */
export class DiscordVoicePlayer implements Player {
  readonly #connection: VoiceConnection;
  readonly #filters: FilterRegistry;
  readonly #releaseTransport?: () => void;
  readonly #player: AudioPlayer;
  readonly #subscription?: Readonly<{ unsubscribe(): void }>;
  readonly #listeners = new Set<(event: PlayerEvent) => void>();
  /** Track opens and closes still running, which release joins before the transport goes. */
  readonly #pending = new Set<Promise<void>>();
  readonly #opening = new Set<AbortController>();
  #track?: ActiveTrack;
  /** Only explicit Player controls carry pause intent. AutoPaused is transport state. */
  #pauseIntent = false;
  #volume = 100;
  #chain?: string;
  #terminal = false;
  #releasePromise?: Promise<void>;

  constructor(connection: VoiceConnection, filters: FilterRegistry, releaseTransport?: () => void) {
    this.#connection = connection;
    this.#filters = filters;
    this.#releaseTransport = releaseTransport;
    this.#player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause, maxMissedFrames: MAX_MISSED_FRAMES },
    });
    this.#subscription = connection.subscribe(this.#player) ?? undefined;
    connection.on("stateChange", this.#onConnectionStateChange);
    this.#player.on("stateChange", this.#onPlayerStateChange);
    this.#player.on("error", this.#onPlayerError);
  }

  get position(): number {
    return this.#track?.track.position ?? 0;
  }

  async play(value: PlaybackRequest): Promise<void> {
    this.#assertOpen();
    if (this.#track || this.#opening.size > 0) throw new Error("Discord Player already has active playback");
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
      throw new Error("Discord Player track was superseded");
    }
    let resource: AudioResource;
    try {
      resource = createAudioResource(track.packets, { inputType: StreamType.Opus });
      track.setPlayedCounter(() => resource.playbackDuration / 20);
    } catch (error: unknown) {
      this.#join(track.close());
      throw error;
    }
    const active: ActiveTrack = {
      itemId: request.itemId,
      track,
      resource,
      started: false,
      start: startSignal(),
      idle: false,
      ended: false,
    };
    this.#track = active;
    try {
      this.#player.play(resource);
      if (this.#pauseIntent) this.#player.pause(true);
      await this.#awaitStart(active);
      this.#assertOpen();
      if (this.#track !== active) throw new Error("Discord Player track was superseded");
      active.started = true;
      this.#watch(active);
    } catch (error: unknown) {
      this.#endTrack(active);
      throw error;
    }
  }

  async pause(): Promise<void> {
    this.#assertOpen();
    if (!this.#player.pause(true)) throw new Error("Discord audio player could not pause");
    this.#pauseIntent = true;
  }

  async resume(): Promise<void> {
    this.#assertOpen();
    if (!this.#player.unpause()) throw new Error("Discord audio player could not resume");
    this.#pauseIntent = false;
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
    if (!this.#terminal) this.#terminal = true;
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

  /** Resolves once the audio player took the track, whether it plays it or holds it without a subscriber. */
  async #awaitStart(active: ActiveTrack): Promise<void> {
    if (HELD_STATES.has(this.#player.state.status)) return;
    const trackFailure = active.track.outcome.then(outcome => {
      if (outcome.type === "failed") throw outcome.error;
      // A tiny track can end while AudioPlayer commits its last frame. Let its state decide.
      return new Promise<never>(() => undefined);
    });
    const result = await Promise.race([
      entersState(this.#player, AudioPlayerStatus.Playing, START_TIMEOUT_MS).then(
        () => true as const,
        () => false as const,
      ),
      entersState(this.#player, AudioPlayerStatus.AutoPaused, START_TIMEOUT_MS).then(
        () => true as const,
        () => false as const,
      ),
      // A matching Idle state means the audio player accepted a very short track before this
      // continuation committed it.
      active.start.completed.then(() => true as const),
      trackFailure,
      active.start.failed,
    ]);
    if (result === true) return;
    throw new Error("Discord audio player did not start the track");
  }

  #watch(active: ActiveTrack): void {
    void active.track.outcome.then(outcome => {
      if (this.#terminal || this.#track !== active) return;
      if (outcome.type === "failed") this.#fail(active, outcome.error);
      else if (outcome.type === "ended") {
        active.ended = true;
        this.#reconcile(active);
      }
    });
  }

  /** Completes a track only after both native resource consumption and the Track's end of input agree. */
  #reconcile(active: ActiveTrack): void {
    if (active.idle && active.ended) this.#finish(active);
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
    this.#player.stop(true);
    this.#join(active.track.close());
  }

  /** Ends the track and reports it as failed; the Player stays usable for the next request. */
  #fail(active: ActiveTrack, error: Error): void {
    if (this.#track !== active) return;
    const started = active.started;
    this.#endTrack(active);
    // A track that never started is reported by its pending play request, not as an item outcome.
    if (started) this.#emit({ type: "failed", itemId: active.itemId, error });
  }

  /**
   * AudioPlayer's Idle event carries no resource. The preceding state identifies the exact track,
   * including one that reached Idle before its start continuation ran.
   */
  readonly #onPlayerStateChange = (previous: AudioPlayer["state"], next: AudioPlayer["state"]): void => {
    if (next.status !== AudioPlayerStatus.Idle) return;
    const active = this.#track;
    if (!active || stateResource(previous) !== active.resource) return;
    if (!active.track.settled) {
      const failure = new Error("Discord audio player stopped before the track ended");
      if (!active.started) active.start.fail(failure);
      this.#fail(active, failure);
      return;
    }
    active.idle = true;
    active.start.complete();
    this.#reconcile(active);
  };

  readonly #onPlayerError = (error: AudioPlayerError): void => {
    const active = this.#track;
    if (!active || active.resource !== error.resource) return;
    const failure = audioPlayerFailure(error);
    if (!active.started) active.start.fail(failure);
    this.#fail(active, failure);
  };

  readonly #onConnectionStateChange = (_previous: VoiceConnection["state"], next: VoiceConnection["state"]): void => {
    if (next.status === VoiceConnectionStatus.Destroyed) {
      this.#retire(new Error("Discord voice connection was destroyed"));
    }
  };

  /** Retires the Player with its session: no later playback, no later outcome, no leaked track. */
  #retire(error: Error): void {
    if (this.#terminal) return;
    const active = this.#track;
    const listeners = [...this.#listeners];
    this.#terminal = true;
    this.#releasePromise ??= this.#cleanup();
    if (!active?.started) return;
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
    attempt(() => this.#connection.off("stateChange", this.#onConnectionStateChange));
    attempt(() => this.#player.off("stateChange", this.#onPlayerStateChange));
    attempt(() => this.#player.off("error", this.#onPlayerError));
    attempt(() => this.#subscription?.unsubscribe());
    attempt(() => this.#player.stop(true));
    if (active) this.#join(active.track.close());
    // Voice must not release its session before every opened input has closed.
    while (this.#pending.size > 0) await Promise.all(this.#pending);
    attempt(() => this.#releaseTransport?.());
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Discord Player cleanup failures");
  }

  #assertOpen(): void {
    if (this.#terminal) throw new Error("Discord Player is retired");
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

function startSignal(): StartSignal {
  let complete!: () => void;
  let fail!: (error: Error) => void;
  const completed = new Promise<void>(resolve => {
    complete = resolve;
  });
  const failed = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  // A native error can arrive before #awaitStart races this promise; mark the rejection observed now.
  void failed.catch(() => undefined);
  return { complete, fail, completed, failed };
}

function stateResource(state: AudioPlayer["state"]): AudioResource | undefined {
  return "resource" in state ? state.resource : undefined;
}

/** AudioPlayerError owns a native resource. Copy only the public diagnostic before it reaches core. */
function audioPlayerFailure(error: AudioPlayerError): Error {
  const failure = new Error(error.message);
  failure.name = error.name;
  return failure;
}
