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
import {
  DisTubeError,
  ErrorCode,
  ErrorReason,
  type FilterEntry,
  type PlaybackRequest,
  type Player,
  type PlayerEvent,
} from "distube";
import { type FfmpegStream, ffmpegFailure, finishedFfmpeg, killFfmpeg, spawnFfmpeg } from "./ffmpeg";
import type { FilterRegistry } from "./filters";
import { playbackRequest } from "./validation";

/** How long a fresh decode has to reach the audio player before the request gives up. */
const START_TIMEOUT_MS = 15_000;

/** States in which the audio player holds a resource without consuming it. */
const PAUSED_STATES: ReadonlySet<AudioPlayerStatus> = new Set([AudioPlayerStatus.Paused, AudioPlayerStatus.AutoPaused]);

/** One track a Player holds, across however many decodes its filters need. */
interface ActiveTrack {
  readonly itemId: string;
  readonly url: string;
  /** Seconds already played when the running decode started, so a re-render keeps the position. */
  offset: number;
  /** Whether the audio player accepted the track, which is what makes a later end an item outcome. */
  started: boolean;
  /** Signals a matching early Idle transition while native startup is still settling. */
  start: StartSignal;
  /** Natural completion needs both this resource's Idle transition and a successful decoder exit. */
  idle: boolean;
  decodeFinished: boolean;
  stream: FfmpegStream;
  resource: AudioResource;
}

/** A replacement decode stays separate from the committed track until it starts or rollback finishes. */
interface Replacement {
  readonly track: ActiveTrack;
  stream: FfmpegStream;
  resource: AudioResource;
  start: StartSignal;
  /** An Idle transition can arrive before the candidate has committed to the active track. */
  idle: boolean;
  /** The native player only replaces the old resource after this becomes true. */
  handedOff: boolean;
}

/** Coordinates native startup events for the decode currently trying to start. */
interface StartSignal {
  complete(): void;
  fail(error: Error): void;
  readonly completed: Promise<void>;
  readonly failed: Promise<never>;
}

/**
 * The long-lived playback backend for one connected voice session.
 *
 * The Player outlives every track and queue that borrows it: only its session's release retires it.
 * Filters and volume live here, so a queue that hands over a new set restarts the decode in place.
 */
export class DiscordVoicePlayer implements Player {
  readonly #connection: VoiceConnection;
  readonly #filters: FilterRegistry;
  readonly #preflight?: () => Promise<void>;
  readonly #player: AudioPlayer;
  readonly #subscription?: Readonly<{ unsubscribe(): void }>;
  readonly #listeners = new Set<(event: PlayerEvent) => void>();
  /** Decoders stopped by ordinary track work still belong to a later terminal release until they close. */
  readonly #retiringStreams = new Set<FfmpegStream>();
  #track?: ActiveTrack;
  #volume = 100;
  #chain?: string;
  #replacement?: Replacement;
  #terminal = false;
  #releasePromise?: Promise<void>;

  constructor(connection: VoiceConnection, filters: FilterRegistry, preflight?: () => Promise<void>) {
    this.#connection = connection;
    this.#filters = filters;
    this.#preflight = preflight;
    this.#player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.#subscription = connection.subscribe(this.#player) ?? undefined;
    connection.on("stateChange", this.#onConnectionStateChange);
    this.#player.on("stateChange", this.#onPlayerStateChange);
    this.#player.on("error", this.#onPlayerError);
  }

  /** Elapsed seconds of the active track, counting the position a filter re-render decoded from. */
  get position(): number {
    const track = this.#track;
    return track ? track.offset + track.resource.playbackDuration / 1000 : 0;
  }

  async play(value: PlaybackRequest): Promise<void> {
    this.#assertOpen();
    if (this.#track) throw new Error("Discord Player already has active playback");
    const request = playbackRequest(value);
    if (this.#preflight) await this.#preflight();
    this.#assertOpen();
    if (this.#track) throw new Error("Discord Player already has active playback");
    const decode = this.#decode(request.resource.url, 0);
    const track: ActiveTrack = {
      itemId: request.itemId,
      url: request.resource.url,
      offset: 0,
      started: false,
      start: startSignal(),
      idle: false,
      decodeFinished: false,
      ...decode,
    };
    this.#track = track;
    this.#handOff(decode.resource);
    try {
      await this.#awaitStart(track.stream, track.start);
      track.started = true;
      this.#watchDecode(track, track.stream);
    } catch (error: unknown) {
      this.#endTrack(track);
      throw error;
    }
  }

  async pause(): Promise<void> {
    this.#assertOpen();
    if (!this.#player.pause(true)) throw new Error("Discord audio player could not pause");
  }

  async resume(): Promise<void> {
    this.#assertOpen();
    if (!this.#player.unpause()) throw new Error("Discord audio player could not resume");
  }

  /** Ends the active track, leaving the Player and its voice connection ready for the next one. */
  async stopTrack(): Promise<void> {
    this.#assertOpen();
    const track = this.#track;
    if (track) this.#endTrack(track);
  }

  async seek(_seconds: number): Promise<void> {
    this.#assertOpen();
    throw new DisTubeError(ErrorCode.UNSUPPORTED, "The default voice engine cannot seek");
  }

  async setVolume(percent: number): Promise<void> {
    this.#assertOpen();
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "volume must be a non-negative number");
    }
    this.#volume = percent;
    this.#track?.resource.volume?.setVolume(percent / 100);
  }

  async setFilters(entries: readonly FilterEntry[]): Promise<void> {
    this.#assertOpen();
    const chain = this.#filters.render(entries);
    if (chain === this.#chain) return;
    const track = this.#track;
    if (!track) {
      this.#chain = chain;
      return;
    }

    // A candidate has to emit PCM before native playback can replace the effective render. This keeps
    // the old decode attached when a new filter chain cannot start at all.
    const previousChain = this.#chain;
    const seconds = this.position;
    const previous = track.stream;
    const paused = PAUSED_STATES.has(this.#player.state.status);
    const candidate = this.#decode(track.url, seconds, chain);
    const replacement: Replacement = {
      track,
      ...candidate,
      start: startSignal(),
      idle: false,
      handedOff: false,
    };
    this.#replacement = replacement;

    let candidateError: unknown;
    try {
      await this.#awaitUsableAudio(candidate.stream);
      this.#assertReplacement(track, replacement);
      replacement.handedOff = true;
      this.#handOff(candidate.resource, paused);
      await this.#awaitStart(candidate.stream, replacement.start);
      this.#assertReplacement(track, replacement);
      track.offset = seconds;
      track.stream = candidate.stream;
      track.resource = candidate.resource;
      track.started = true;
      track.idle = replacement.idle;
      track.decodeFinished = false;
      this.#chain = chain;
      this.#replacement = undefined;
      this.#watchDecode(track, candidate.stream);
      this.#reconcileTrack(track);
      this.#retireStream(previous);
      return;
    } catch (error: unknown) {
      candidateError = error;
      this.#retireStream(candidate.stream);
    }

    if (this.#terminal || this.#track !== track || this.#replacement !== replacement) throw candidateError;
    if (!replacement.handedOff) {
      this.#replacement = undefined;
      throw candidateError;
    }

    let rollback: { stream: FfmpegStream; resource: AudioResource } | undefined;
    try {
      rollback = this.#decode(track.url, seconds, previousChain);
      replacement.stream = rollback.stream;
      replacement.resource = rollback.resource;
      replacement.start = startSignal();
      replacement.idle = false;
      replacement.handedOff = true;
      await this.#awaitUsableAudio(rollback.stream);
      this.#assertReplacement(track, replacement);
      this.#handOff(rollback.resource, paused);
      await this.#awaitStart(rollback.stream, replacement.start);
      this.#assertReplacement(track, replacement);
      track.offset = seconds;
      track.stream = rollback.stream;
      track.resource = rollback.resource;
      track.started = true;
      track.idle = replacement.idle;
      track.decodeFinished = false;
      this.#replacement = undefined;
      this.#watchDecode(track, rollback.stream);
      this.#reconcileTrack(track);
      this.#retireStream(previous);
    } catch (rollbackError: unknown) {
      if (rollback) this.#retireStream(rollback.stream);
      this.#replacement = undefined;
      const failure = filterReplacementFailure(candidateError, rollbackError);
      this.#retire(failure);
      throw failure;
    }

    throw candidateError;
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

  /** Spawns one decode of `url` at `seconds` under an explicit filter chain and volume. */
  #decode(url: string, seconds: number, chain = this.#chain): { stream: FfmpegStream; resource: AudioResource } {
    const stream = spawnFfmpeg(url, seconds, chain);
    const resource = createAudioResource(stream.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    resource.volume?.setVolume(this.#volume / 100);
    return { stream, resource };
  }

  /** Hands a decode to the audio player, keeping an explicit pause across a mid-track swap. */
  #handOff(resource: AudioResource, paused = PAUSED_STATES.has(this.#player.state.status)): void {
    this.#player.play(resource);
    if (paused) this.#player.pause(true);
  }

  /** Waits for one PCM chunk without replacing the native resource that is still audible. */
  #awaitUsableAudio(stream: FfmpegStream): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const complete = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        stream.stdout.off("data", onData);
        stream.stdout.off("error", onError);
        if (error) reject(error);
        else resolve();
      };
      const onData = (chunk: string | Buffer): void => {
        if ((typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length) === 0) return;
        // Do not let this readiness probe drain the candidate before AudioPlayer takes ownership.
        stream.stdout.pause();
        complete();
      };
      const onError = (error: Error): void => complete(error);
      timer = setTimeout(
        () => complete(new Error("FFmpeg did not produce audio before the start timeout")),
        START_TIMEOUT_MS,
      );
      stream.stdout.on("data", onData);
      stream.stdout.once("error", onError);
      void stream.outcome.then(outcome => {
        if (!finishedFfmpeg(outcome)) complete(ffmpegFailure(outcome));
        else complete(new Error("FFmpeg ended before producing audio"));
      });
    });
  }

  /** Resolves once the audio player took a decode, whether it plays it or holds it without a subscriber. */
  async #awaitStart(stream: FfmpegStream, signal?: StartSignal): Promise<void> {
    if (PAUSED_STATES.has(this.#player.state.status)) return;
    const decodeFailure = stream.outcome.then(outcome => {
      if (!finishedFfmpeg(outcome)) throw ffmpegFailure(outcome);
      // A tiny valid decode can finish while AudioPlayer commits its last frame. Let its state decide
      // whether playback started instead of misclassifying that successful exit as a startup failure.
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
      // A matching Idle state means the audio player accepted a very short decode before this
      // continuation committed it to the track.
      signal?.completed.then(() => true as const) ?? new Promise<never>(() => undefined),
      // A decoder failure says so sooner than the native start timeout can.
      decodeFailure,
      signal?.failed ?? new Promise<never>(() => undefined),
    ]);
    if (result === true) return;
    throw new Error("Discord audio player did not start the track");
  }

  #assertReplacement(track: ActiveTrack, replacement: Replacement): void {
    if (this.#terminal || this.#track !== track || this.#replacement !== replacement) {
      throw new Error("Discord Player replacement was superseded");
    }
  }

  /** Associates this process only with the resource that committed it, never an older filter candidate. */
  #watchDecode(track: ActiveTrack, stream: FfmpegStream): void {
    void stream.outcome.then(outcome => {
      if (this.#terminal || this.#track !== track || track.stream !== stream || !track.started) return;
      if (!finishedFfmpeg(outcome)) {
        this.#fail(track, ffmpegFailure(outcome));
        return;
      }
      track.decodeFinished = true;
      this.#reconcileTrack(track);
    });
  }

  /** Completes a decode only after both native resource consumption and the decoder agree. */
  #reconcileTrack(track: ActiveTrack): void {
    if (track.idle && track.decodeFinished) this.#finish(track);
  }

  /** Keeps a stopped decoder owned until its close callback proves it released the process. */
  #retireStream(stream: FfmpegStream): void {
    if (this.#retiringStreams.has(stream)) return;
    this.#retiringStreams.add(stream);
    void stream.outcome.then(() => this.#retiringStreams.delete(stream));
    killFfmpeg(stream);
  }

  /** Reports natural completion only after the same decode exits successfully and its resource becomes idle. */
  #finish(track: ActiveTrack): void {
    if (this.#track !== track) return;
    this.#track = undefined;
    this.#retireStream(track.stream);
    this.#emit({ type: "finished", itemId: track.itemId });
  }

  /** Ends the track's audio without touching the Player, its listeners, or the connection. */
  #endTrack(track: ActiveTrack): void {
    if (this.#track !== track) return;
    this.#track = undefined;
    const replacement = this.#replacement;
    if (replacement?.track === track) {
      this.#replacement = undefined;
      this.#retireStream(replacement.stream);
    }
    this.#player.stop(true);
    this.#retireStream(track.stream);
  }

  /** Ends the track and reports it as failed; the Player stays usable for the next request. */
  #fail(track: ActiveTrack, error: Error): void {
    if (this.#track !== track) return;
    const started = track.started;
    this.#endTrack(track);
    // A track that never started is reported by its pending play request, not as an item outcome.
    if (started) this.#emit({ type: "failed", itemId: track.itemId, error });
  }

  /**
   * AudioPlayer's Idle event carries no resource. The preceding state identifies the exact decode,
   * including one that reached Idle before its start continuation or filter commit ran.
   */
  readonly #onPlayerStateChange = (previous: AudioPlayer["state"], next: AudioPlayer["state"]): void => {
    if (next.status !== AudioPlayerStatus.Idle) return;
    const resource = stateResource(previous);
    const track = this.#track;
    if (track && resource === track.resource) {
      track.idle = true;
      track.start.complete();
      this.#reconcileTrack(track);
      return;
    }
    const replacement = this.#replacement;
    if (replacement && resource === replacement.resource) {
      replacement.idle = true;
      replacement.start.complete();
    }
  };

  readonly #onPlayerError = (error: AudioPlayerError): void => {
    const replacement = this.#replacement;
    if (replacement?.resource === error.resource) {
      replacement.start.fail(error);
      return;
    }
    const track = this.#track;
    if (!track || track.resource !== error.resource) return;
    if (!track.started) track.start.fail(error);
    this.#fail(track, error);
  };

  readonly #onConnectionStateChange = (_previous: VoiceConnection["state"], next: VoiceConnection["state"]): void => {
    if (next.status === VoiceConnectionStatus.Destroyed) {
      this.#retire(new Error("Discord voice connection was destroyed"));
    }
  };

  /** Retires the Player with its session: no later playback, no later outcome, no leaked decode. */
  #retire(error: Error): void {
    if (this.#terminal) return;
    const track = this.#track;
    const listeners = [...this.#listeners];
    this.#terminal = true;
    this.#releasePromise ??= this.#cleanup(track);
    if (!track?.started) return;
    const outcome: PlayerEvent = { type: "failed", itemId: track.itemId, error, terminal: true };
    for (const listener of listeners) deliver(listener, outcome);
  }

  async #cleanup(track = this.#track): Promise<void> {
    const replacement = this.#replacement;
    const activeStreams = [track?.stream, replacement?.stream].filter(
      (stream): stream is FfmpegStream => stream !== undefined,
    );
    const streams = new Set([...this.#retiringStreams, ...activeStreams]);
    this.#track = undefined;
    this.#replacement = undefined;
    this.#listeners.clear();
    const failures: Error[] = [];
    try {
      this.#connection.off("stateChange", this.#onConnectionStateChange);
    } catch (error: unknown) {
      failures.push(asError(error));
    }
    try {
      this.#player.off("stateChange", this.#onPlayerStateChange);
    } catch (error: unknown) {
      failures.push(asError(error));
    }
    try {
      this.#player.off("error", this.#onPlayerError);
    } catch (error: unknown) {
      failures.push(asError(error));
    }
    try {
      this.#subscription?.unsubscribe();
    } catch (error: unknown) {
      failures.push(asError(error));
    }
    try {
      this.#player.stop(true);
    } catch (error: unknown) {
      failures.push(asError(error));
    }
    for (const stream of activeStreams) {
      try {
        this.#retireStream(stream);
      } catch (error: unknown) {
        failures.push(asError(error));
      }
    }
    // A killed child can still hold FFmpeg resources until its close event. Voice must not release its
    // session before every active or already-retiring decoder has reported that terminal state.
    await Promise.all([...streams].map(stream => stream.outcome));
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
  // A native error can arrive while candidate PCM is still proving readiness. Mark the rejection
  // observed now; #awaitStart still receives the original rejected Promise once it takes over.
  void failed.catch(() => undefined);
  return { complete, fail, completed, failed };
}

function stateResource(state: AudioPlayer["state"]): AudioResource | undefined {
  return "resource" in state ? state.resource : undefined;
}

function filterReplacementFailure(candidate: unknown, rollback: unknown): AggregateError {
  return new AggregateError(
    [asError(candidate), asError(rollback)],
    "Discord Player filter replacement and rollback failed",
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
