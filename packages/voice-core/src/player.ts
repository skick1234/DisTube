import type { AudioPlayer, AudioPlayerError, AudioResource, VoiceConnection } from "@discordjs/voice";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { DisTubeError } from "distube";
import type {
  FilterEntry,
  PlaybackResource,
  Player,
  TrackEnd,
  TrackOptions,
  VoiceSession,
  VoiceSessionEvent,
} from "distube/integrations";
import type { FilterRegistry } from "./engine";
import type { LocalPlaybackResource } from "./sources";
import { probeFilters, Track, type TrackSettings } from "./track";

const MAX_MISSED_FRAMES = 15_000 / 20;

const FINISHED: TrackEnd = Object.freeze({ reason: "finished" });
const STOPPED: TrackEnd = Object.freeze({ reason: "stopped" });
const REPLACED: TrackEnd = Object.freeze({ reason: "replaced" });

const STARTED: ReadonlySet<AudioPlayerStatus> = new Set([
  AudioPlayerStatus.Playing,
  AudioPlayerStatus.AutoPaused,
  AudioPlayerStatus.Paused,
]);

export interface DiscordVoicePlayerOptions {
  readonly connection: VoiceConnection;
  readonly session: VoiceSession;
  readonly filters: FilterRegistry;
  readonly opusComplexity: number;
  readonly readAhead: number;
  readonly releaseTransport: () => void;
  readonly onClosed: (error: Error) => void;
}

/** One `play` call, from opening its Track to its single end. */
class Playback {
  readonly controller = new AbortController();
  readonly onStart: () => void;
  readonly ended: Promise<TrackEnd>;
  closed!: Promise<void>;
  track?: Track;
  audio?: AudioResource;
  started = false;
  idle = false;
  inputEnded = false;
  #settled = false;
  readonly #settle: PromiseWithResolvers<TrackEnd>;

  constructor(onStart: () => void) {
    this.onStart = onStart;
    this.#settle = Promise.withResolvers();
    this.ended = this.#settle.promise;
    void this.ended.catch(() => undefined);
  }

  get settled(): boolean {
    return this.#settled;
  }

  end(end: TrackEnd): void {
    if (this.#markSettled()) this.#settle.resolve(end);
  }

  fail(error: unknown): void {
    if (this.#markSettled()) this.#settle.reject(error);
  }

  #markSettled(): boolean {
    if (this.#settled) return false;
    this.#settled = true;
    this.controller.abort();
    return true;
  }
}

/**
 * The playback backend for one attached voice connection.
 *
 * It outlives tracks until release or connection loss. Volume and filters live here and apply to the running
 * Track in place; the encoder follows the session's channel bitrate.
 */
export class DiscordVoicePlayer implements Player {
  readonly #connection: VoiceConnection;
  readonly #session: VoiceSession;
  readonly #filters: FilterRegistry;
  readonly #opusComplexity: number;
  readonly #readAhead: number;
  readonly #releaseTransport: () => void;
  readonly #onClosed: (error: Error) => void;
  readonly #player: AudioPlayer;
  readonly #subscription?: Readonly<{ unsubscribe(): void }>;
  readonly #unsubscribeSession: () => void;
  readonly #closing = new Set<Promise<void>>();
  #current?: Playback;
  #paused = false;
  #volume = 100;
  #chain?: string;
  #released = false;
  #release?: Promise<void>;

  constructor(options: DiscordVoicePlayerOptions) {
    this.#connection = options.connection;
    this.#session = options.session;
    this.#filters = options.filters;
    this.#opusComplexity = options.opusComplexity;
    this.#readAhead = options.readAhead;
    this.#releaseTransport = options.releaseTransport;
    this.#onClosed = options.onClosed;
    this.#player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause, maxMissedFrames: MAX_MISSED_FRAMES },
    });
    this.#subscription = this.#connection.subscribe(this.#player) ?? undefined;
    this.#unsubscribeSession = this.#session.subscribe(this.#onSessionEvent);
    this.#connection.on("stateChange", this.#onConnectionStateChange);
    this.#player.on("stateChange", this.#onPlayerStateChange);
    this.#player.on("error", this.#onPlayerError);
  }

  get position(): number {
    return this.#current?.track?.position ?? 0;
  }

  play(resource: PlaybackResource, { signal, onStart }: TrackOptions): Promise<TrackEnd> {
    try {
      this.#assertOpen();
      if (resource.kind === "encoded") {
        throw new DisTubeError("UNSUPPORTED", "The built-in voice engine cannot play encoded resources");
      }
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    this.#paused = false;
    const previous = this.#current;
    const playback = new Playback(onStart);
    this.#current = playback;
    previous?.end(REPLACED);
    const run = this.#run(playback, resource, signal, previous);
    const closed = run.then(
      () => undefined,
      () => undefined,
    );
    playback.closed = closed;
    this.#closing.add(closed);
    void closed.then(() => this.#closing.delete(closed));
    return run;
  }

  async pause(): Promise<void> {
    this.#assertOpen();
    this.#paused = true;
    this.#player.pause(true);
  }

  async resume(): Promise<void> {
    this.#assertOpen();
    this.#paused = false;
    this.#player.unpause();
  }

  async stopTrack(): Promise<void> {
    this.#assertOpen();
    const playback = this.#current;
    playback?.end(STOPPED);
    await playback?.closed;
  }

  async seek(seconds: number): Promise<void> {
    this.#assertOpen();
    const track = this.#current?.track;
    if (!track) throw new DisTubeError("INVALID_STATE", "Player has no active track");
    await track.seek(seconds);
  }

  async setVolume(percent: number): Promise<void> {
    this.#assertOpen();
    this.#volume = percent;
    this.#current?.track?.setVolume(percent);
  }

  async setFilters(entries: readonly FilterEntry[]): Promise<void> {
    this.#assertOpen();
    const chain = this.#filters.render(entries);
    if (chain === this.#chain) return;
    const track = this.#current?.track;
    if (track && !track.settled) await track.setFilters(chain);
    else if (chain !== undefined) await probeFilters(chain);
    this.#chain = chain;
  }

  release(): Promise<void> {
    this.#release ??= this.#cleanup();
    return this.#release;
  }

  async #run(
    playback: Playback,
    resource: LocalPlaybackResource,
    signal: AbortSignal,
    previous?: Playback,
  ): Promise<TrackEnd> {
    const stop = (): void => playback.end(STOPPED);
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
    try {
      const settings = this.#settings();
      const track = await Track.open(resource, settings, playback.controller.signal);
      playback.track = track;
      void track.outcome.then(outcome => {
        if (outcome.type === "failed") playback.fail(outcome.error);
        else if (outcome.type === "ended") {
          playback.inputEnded = true;
          this.#reconcile(playback);
        }
      });
      await previous?.closed;
      await this.#catchUp(track, settings);
      if (!playback.settled) this.#handOff(playback, track);
    } catch (error: unknown) {
      playback.fail(error);
    }
    try {
      return await playback.ended;
    } finally {
      signal.removeEventListener("abort", stop);
      if (this.#current === playback) this.#current = undefined;
      if (playback.audio && stateResource(this.#player.state) === playback.audio) this.#player.stop(true);
      await playback.track?.close();
    }
  }

  #settings(): TrackSettings {
    return {
      volume: this.#volume,
      chain: this.#chain,
      bitrate: this.#session.bitrate,
      opusComplexity: this.#opusComplexity,
      readAhead: this.#readAhead,
    };
  }

  async #catchUp(track: Track, opened: TrackSettings): Promise<void> {
    if (opened.volume !== this.#volume) track.setVolume(this.#volume);
    if (opened.bitrate !== this.#session.bitrate) track.setBitrate(this.#session.bitrate);
    if (opened.chain !== this.#chain) await track.setFilters(this.#chain);
  }

  #handOff(playback: Playback, track: Track): void {
    const audio = createAudioResource(track.packets, { inputType: StreamType.Opus });
    track.setPlayedCounter(() => audio.playbackDuration / 20);
    playback.audio = audio;
    this.#player.play(audio);
  }

  #start(playback: Playback): void {
    if (playback.started) return;
    playback.started = true;
    try {
      playback.onStart();
    } catch (error: unknown) {
      playback.fail(error);
    }
  }

  #reconcile(playback: Playback): void {
    if (playback.idle && playback.inputEnded) playback.end(FINISHED);
  }

  /** AudioPlayer's Idle event carries no resource, so the preceding state identifies the track that ended. */
  readonly #onPlayerStateChange = (previous: AudioPlayer["state"], next: AudioPlayer["state"]): void => {
    const playback = this.#current;
    const audio = playback?.audio;
    if (!playback || !audio || playback.settled) return;
    if (stateResource(next) === audio && STARTED.has(next.status)) {
      this.#start(playback);
      if (next.status === AudioPlayerStatus.Playing && this.#paused) this.#player.pause(true);
      return;
    }
    if (next.status !== AudioPlayerStatus.Idle || stateResource(previous) !== audio) return;
    if (!playback.track?.settled) {
      playback.fail(new Error("Discord audio player stopped before the track ended"));
      return;
    }
    this.#start(playback);
    playback.idle = true;
    this.#reconcile(playback);
  };

  readonly #onPlayerError = (error: AudioPlayerError): void => {
    const playback = this.#current;
    if (playback?.audio && playback.audio === error.resource) playback.fail(audioPlayerFailure(error));
  };

  readonly #onSessionEvent = (event: VoiceSessionEvent): void => {
    if (event.type === "connected") this.#current?.track?.setBitrate(this.#session.bitrate);
  };

  readonly #onConnectionStateChange = (_previous: VoiceConnection["state"], next: VoiceConnection["state"]): void => {
    if (next.status !== VoiceConnectionStatus.Destroyed || this.#released) return;
    const error = new DisTubeError("VOICE_FAILED", "Discord voice connection was destroyed");
    this.#current?.fail(error);
    void this.release().catch(() => undefined);
    try {
      this.#onClosed(error);
    } catch {}
  };

  async #cleanup(): Promise<void> {
    this.#released = true;
    this.#current?.end(STOPPED);
    while (this.#closing.size > 0) await Promise.all(this.#closing);
    const failures: unknown[] = [];
    for (const step of [
      () => this.#connection.off("stateChange", this.#onConnectionStateChange),
      () => this.#player.off("stateChange", this.#onPlayerStateChange),
      () => this.#player.off("error", this.#onPlayerError),
      () => this.#unsubscribeSession(),
      () => this.#subscription?.unsubscribe(),
      () => this.#player.stop(true),
      () => this.#releaseTransport(),
    ]) {
      try {
        step();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Discord Player cleanup failures");
  }

  #assertOpen(): void {
    if (this.#released) throw new DisTubeError("INVALID_STATE", "Discord Player is released");
  }
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
