import type { FfmpegStream, FilterRegistry, LocalPlaybackResource } from "@distube/voice-core/core";
import {
  asError,
  ffmpegFailure,
  finishedFfmpeg,
  killFfmpeg,
  playbackRequest,
  spawnFfmpeg,
} from "@distube/voice-core/core";
import { DisTubeError } from "distube";
import type { FilterEntry, PlaybackRequest, Player, PlayerEvent } from "distube/integrations";
import type { VoiceConnection, VoiceResourceOptions } from "eris";
import { ensureErisErrorSink, type NativeCurrent, observeStopPlaying } from "./native-playback";

/** How long a decode may go without delivering audio before Eris gives the track up. */
const VOICE_DATA_TIMEOUT_MS = 15_000;

/** One track a Player holds, across however many decodes its filters need. */
interface ActiveTrack {
  readonly itemId: string;
  readonly input: LocalPlaybackResource;
  /** Seconds already played when the running decode started, so a re-render keeps the position. */
  offset: number;
  /** Whether Eris accepted the track, which is what makes a later end an item outcome. */
  started: boolean;
  /** Eris receives PCM from this package-owned decoder rather than spawning a replacement itself. */
  stream: FfmpegStream;
  /** The exact Eris current-stream object that started this decode. */
  nativeCurrent?: NativeCurrent;
  /** Natural completion needs both the decoder's successful exit and Eris draining its PCM stream. */
  ended: boolean;
  decodeFinished: boolean;
}

interface Replacement {
  readonly track: ActiveTrack;
  stream: FfmpegStream;
  handedOff: boolean;
}

/**
 * The long-lived playback backend for one connected Eris voice session.
 *
 * The Player outlives tracks and queues until release or terminal transport failure.
 * This adapter owns each FFmpeg decode and hands Eris PCM after the decoder has started.
 */
export class ErisVoicePlayer implements Player {
  readonly #connection: VoiceConnection;
  readonly #filters: FilterRegistry;
  readonly #releaseTransport?: () => void;
  readonly #listeners = new Set<(event: PlayerEvent) => void>();
  /** Decoders stopped by track work remain owned until their child process closes. */
  readonly #retiringStreams = new Set<FfmpegStream>();
  readonly #decodeControllers = new Set<AbortController>();
  readonly #pendingDecodes = new Set<Promise<void>>();
  #restoreStopPlaying?: () => void;
  #track?: ActiveTrack;
  /** The only pause authority this Player reads. Eris constructs its connection paused, so the
   * native flag starts `true` and must never be trusted for playback intent. */
  #pauseIntent = false;
  #volume = 100;
  #chain?: string;
  #restarting = false;
  #replacement?: Replacement;
  #terminal = false;
  #releasePromise?: Promise<void>;

  constructor(connection: VoiceConnection, filters: FilterRegistry, releaseTransport?: () => void) {
    this.#connection = connection;
    this.#filters = filters;
    this.#releaseTransport = releaseTransport;
    ensureErisErrorSink(connection);
    this.#restoreStopPlaying = observeStopPlaying(connection, this.#onNativeStop);
    connection.on("disconnect", this.#onDisconnect);
  }

  /** Elapsed seconds of the active track, counting the position a filter re-render decoded from. */
  get position(): number {
    const track = this.#track;
    return track ? track.offset + (this.#connection.current?.playTime ?? 0) / 1000 : 0;
  }

  async play(value: PlaybackRequest): Promise<void> {
    this.#assertOpen();
    if (this.#track) throw new Error("Eris Player already has active playback");
    const request = playbackRequest(value);
    const stream = await this.#decode(request.resource, 0);
    if (this.#terminal || this.#track) {
      this.#retireStream(stream);
      this.#assertOpen();
      throw new Error("Eris Player already has active playback");
    }
    const track: ActiveTrack = {
      itemId: request.itemId,
      input: request.resource,
      offset: 0,
      started: false,
      stream,
      ended: false,
      decodeFinished: false,
    };
    this.#track = track;
    try {
      await this.#awaitUsableAudio(stream);
      this.#assertOpen();
      if (this.#track !== track) throw new Error("Eris Player track was superseded");
      const nativeCurrent = this.#handOff(stream);
      track.nativeCurrent = nativeCurrent;
      track.started = true;
      this.#watchDecode(track, stream);
      this.#reconcileTrack(track);
    } catch (error: unknown) {
      this.#endTrack(track);
      throw error;
    }
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
    this.#pauseIntent = false;
    this.#connection.resume();
  }

  /** Ends the active track, leaving the Player and its voice connection ready for the next one. */
  async stopTrack(): Promise<void> {
    this.#assertOpen();
    this.#abortDecodes();
    const track = this.#track;
    if (track) this.#endTrack(track);
  }

  async seek(seconds: number): Promise<void> {
    this.#assertOpen();
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new DisTubeError("INVALID_ARGUMENT", "seek position must be non-negative");
    await this.#replace(seconds, this.#chain);
  }

  async setVolume(percent: number): Promise<void> {
    this.#assertOpen();
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) {
      throw new DisTubeError("INVALID_ARGUMENT", "volume must be a non-negative number");
    }
    this.#volume = percent;
    // Eris keeps the level on its encoder, so it survives every later track on this connection.
    this.#connection.setVolume(percent / 100);
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

    await this.#replace(this.position, chain);
  }

  async #replace(seconds: number, chain: string | undefined): Promise<void> {
    const track = this.#track;
    if (!track) throw new DisTubeError("INVALID_STATE", "Player has no active track");
    if (track.input.kind === "stream" || (track.input.kind === "url" && track.input.seekable !== true)) {
      throw new DisTubeError("UNSUPPORTED", "This resource cannot be restarted");
    }
    // Eris replaces playback as soon as play() runs. Prove the candidate decoder has PCM first so a
    // pre-handoff failure leaves the audible render alone.
    const previous = track.stream;
    const paused = this.#pauseIntent;
    const candidate = await this.#decode(track.input, seconds, chain);
    if (this.#terminal || this.#track !== track) {
      this.#retireStream(candidate);
      throw new Error("Eris Player replacement was superseded");
    }
    const replacement: Replacement = { track, stream: candidate, handedOff: false };
    this.#replacement = replacement;

    let candidateError: unknown;
    try {
      await this.#awaitUsableAudio(candidate);
      this.#assertReplacement(track, replacement);
      replacement.handedOff = true;
      const nativeCurrent = this.#handOff(candidate, paused);
      this.#assertReplacement(track, replacement);
      track.stream = candidate;
      track.nativeCurrent = nativeCurrent;
      track.offset = seconds;
      track.started = true;
      track.ended = false;
      track.decodeFinished = false;
      this.#chain = chain;
      this.#replacement = undefined;
      this.#watchDecode(track, candidate);
      this.#reconcileTrack(track);
      this.#retireStream(previous);
      return;
    } catch (error: unknown) {
      candidateError = error;
      this.#retireStream(candidate);
    }

    if (this.#terminal || this.#track !== track || this.#replacement !== replacement) throw candidateError;
    if (!replacement.handedOff) {
      this.#replacement = undefined;
      throw candidateError;
    }

    this.#replacement = undefined;
    const failure = asError(candidateError);
    this.#fail(track, failure);
    throw failure;
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

  /** Starts one package-owned decode at `seconds` with its filter chain applied before Eris sees PCM. */
  async #decode(input: LocalPlaybackResource, seconds: number, chain = this.#chain): Promise<FfmpegStream> {
    const controller = new AbortController();
    this.#decodeControllers.add(controller);
    const task = spawnFfmpeg(input, seconds, chain, controller.signal).then(stream => {
      if (controller.signal.aborted || this.#terminal) {
        this.#retireStream(stream);
        throw new Error("Eris Player decoder was superseded");
      }
      return stream;
    });
    const settled = task.then(
      () => undefined,
      () => undefined,
    );
    this.#pendingDecodes.add(settled);
    try {
      return await task;
    } finally {
      this.#pendingDecodes.delete(settled);
      this.#decodeControllers.delete(controller);
    }
  }

  #abortDecodes(): void {
    for (const controller of this.#decodeControllers) controller.abort();
  }

  /** Waits for a PCM frame without touching Eris's currently attached stream. */
  #awaitUsableAudio(stream: FfmpegStream): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const complete = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        stream.stdout.off("readable", onReadable);
        stream.stdout.off("error", onError);
        if (error) reject(error);
        else resolve();
      };
      const onReadable = (): void => {
        if (stream.stdout.readableLength > 0) complete();
      };
      const onError = (error: Error): void => complete(error);
      timer = setTimeout(
        () => complete(new Error("FFmpeg did not produce audio before the start timeout")),
        VOICE_DATA_TIMEOUT_MS,
      );
      stream.stdout.on("readable", onReadable);
      onReadable();
      stream.stdout.once("error", onError);
      void stream.outcome.then(outcome => {
        if (!finishedFfmpeg(outcome)) complete(ffmpegFailure(outcome));
        else complete(new Error("FFmpeg ended before producing audio"));
      });
    });
  }

  /** Replaces the native PCM stream only after the candidate decoder is ready. */
  #handOff(stream: FfmpegStream, paused = this.#pauseIntent): NativeCurrent {
    this.#restarting = true;
    try {
      this.#connection.stopPlaying();
      this.#connection.play(stream.stdout, this.#resourceOptions());
    } finally {
      this.#restarting = false;
    }
    if (!this.#connection.playing) throw new Error("Eris voice connection could not start the track");
    const current = this.#connection.current;
    if (!current) throw new Error("Eris voice connection did not expose the active stream");
    this.#connection.setVolume(this.#volume / 100);
    // Eris leaves `paused` set from its connection constructor, so an unpaused intent must actively
    // clear it or every first track of a session would sit silent.
    if (paused) this.#connection.pause();
    else this.#connection.resume();
    return current;
  }

  /** Eris receives raw PCM, so its fixed decoder-command lookup is never used for playback. */
  #resourceOptions(): VoiceResourceOptions {
    return {
      format: "pcm",
      inlineVolume: true,
      voiceDataTimeout: VOICE_DATA_TIMEOUT_MS,
    };
  }

  #assertReplacement(track: ActiveTrack, replacement: Replacement): void {
    if (this.#terminal || this.#track !== track || this.#replacement !== replacement) {
      throw new Error("Eris Player replacement was superseded");
    }
  }

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

  #reconcileTrack(track: ActiveTrack): void {
    if (track.ended && track.decodeFinished) this.#finish(track);
  }

  /** Keeps a stopped decoder owned until its close callback proves it released the process. */
  #retireStream(stream: FfmpegStream): void {
    if (this.#retiringStreams.has(stream)) return;
    this.#retiringStreams.add(stream);
    void stream.outcome.then(() => this.#retiringStreams.delete(stream));
    killFfmpeg(stream);
  }

  /** Ends the track's audio without touching the Player, its listeners, or the connection. */
  #endTrack(track: ActiveTrack): void {
    if (this.#track !== track) return;
    this.#abortDecodes();
    this.#track = undefined;
    const replacement = this.#replacement;
    this.#replacement = undefined;
    this.#retireStream(track.stream);
    if (replacement && replacement.stream !== track.stream) this.#retireStream(replacement.stream);
    this.#connection.stopPlaying();
  }

  /** Reports natural completion only when the exact PCM decoder exited successfully. */
  #finish(track: ActiveTrack): void {
    if (this.#track !== track) return;
    this.#track = undefined;
    this.#retireStream(track.stream);
    this.#emit({ type: "finished", itemId: track.itemId });
  }

  /** Ends the track and reports it as failed; the Player stays usable for the next request. */
  #fail(track: ActiveTrack, error: Error): void {
    if (this.#track !== track) return;
    const started = track.started;
    this.#endTrack(track);
    // A track that never started is reported by its pending play request, not as an item outcome.
    if (started) this.#emit({ type: "failed", itemId: track.itemId, error });
  }

  /** Accepts Eris completion only for the exact native stream this active track started. */
  readonly #onNativeStop = (current: NativeCurrent | undefined): void => {
    const track = this.#track;
    if (this.#terminal || this.#restarting || !track?.started || current !== track.nativeCurrent) return;
    // Eris stops playback while tearing a connection down, so a stop on a connection that is no
    // longer ready is the disconnect arriving rather than a finished track.
    if (!this.#connection.ready) return;
    track.ended = true;
    this.#reconcileTrack(track);
  };

  readonly #onDisconnect = (error?: Error): void => {
    this.#retire(error ?? new Error("Eris voice connection was disconnected"));
  };

  /** Retires the Player with its session: no later playback, no later outcome, no leaked decode. */
  #retire(error: Error): void {
    if (this.#terminal) return;
    const track = this.#track;
    const listeners = [...this.#listeners];
    this.#terminal = true;
    this.#releasePromise ??= this.#cleanup();
    if (!track?.started) return;
    const outcome: PlayerEvent = { type: "failed", itemId: track.itemId, error, terminal: true };
    for (const listener of listeners) deliver(listener, outcome);
  }

  async #cleanup(): Promise<void> {
    this.#abortDecodes();
    const track = this.#track;
    const replacement = this.#replacement;
    const activeStreams = [track?.stream, replacement?.stream].filter(
      (stream): stream is FfmpegStream => stream !== undefined,
    );
    this.#track = undefined;
    this.#replacement = undefined;
    this.#listeners.clear();
    const failures: Error[] = [];
    try {
      this.#connection.off("disconnect", this.#onDisconnect);
    } catch (error: unknown) {
      failures.push(asError(error));
    }
    const restoreStopPlaying = this.#restoreStopPlaying;
    this.#restoreStopPlaying = undefined;
    try {
      restoreStopPlaying?.();
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
    try {
      this.#connection.stopPlaying();
    } catch (error: unknown) {
      failures.push(asError(error));
    }
    // A signal only asks the process to stop. Wait for every known decoder close before Voice releases
    // its Eris session, including a decoder a preceding queue stop already retired.
    await Promise.all(this.#pendingDecodes);
    const streams = new Set([...this.#retiringStreams, ...activeStreams]);
    await Promise.all([...streams].map(stream => stream.outcome));
    try {
      this.#releaseTransport?.();
    } catch (error: unknown) {
      failures.push(asError(error));
    }
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
