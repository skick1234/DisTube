import type { Readable } from "node:stream";
import type { Playlist, Song } from "./media";

/** Identity shared by supported native platform voice channels. */
export type VoiceChannelTarget = { readonly id: string } & (
  | { readonly guildId: string }
  | { readonly guild: { readonly id: string } }
);

/** What core accepts wherever media enters the client. */
export type ResolvableInput = string | Song | Playlist;

export type DiagnosticSeverity = "debug" | "info" | "warning" | "error";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly stage: string;
  readonly message: string;
  readonly plugin?: string;
  readonly guildId?: string;
  /** Source seconds of that guild's current track. */
  readonly position?: number;
  /** Flat facts the stage defines. Never holds resources, playable URLs, headers, paths or tokens. */
  readonly data?: Readonly<Record<string, string | number | boolean>>;
  readonly error?: unknown;
}

/** A public HTTP(S) URL fetched without headers; seekable when the engine reads it by byte range. Authenticated media is a `reader` or `timed` resource. */
export interface UrlPlaybackResource {
  readonly kind: "url";
  readonly url: string;
  dispose?(): void | Promise<void>;
}

export interface FilePlaybackResource {
  readonly kind: "file";
  readonly path: string;
  dispose?(): void | Promise<void>;
}

export interface StreamPlaybackResource {
  readonly kind: "stream";
  readonly stream: Readable;
  dispose?(): void | Promise<void>;
}

/** Byte-addressable media the engine seeks through the container index, or from the start for MP3. */
export interface ReaderPlaybackResource {
  readonly kind: "reader";
  readonly size: number;
  /** Forces this container; when absent, the engine identifies the format from the bytes. */
  readonly container?: "webm" | "mp4";
  /** Returns bytes `start` through `end` inclusive; `signal` aborts when the engine no longer needs them. */
  read(start: number, end: number, signal: AbortSignal): Readable;
  dispose?(): void | Promise<void>;
}

/** Media that can only start at a time; `open` returns the container header, then media from at or before `seconds`. */
export interface TimedPlaybackResource {
  readonly kind: "timed";
  /** Forces this container; when absent, the engine identifies the format from the bytes. */
  readonly container?: "webm" | "mp4";
  open(seconds: number, signal: AbortSignal): Readable;
  dispose?(): void | Promise<void>;
}

/** A backend-native track, such as a Lavalink encoded track. Only the engine that produced it can play it. */
export interface EncodedPlaybackResource {
  readonly kind: "encoded";
  readonly format: string;
  readonly encoded: string;
  readonly seekable?: boolean;
  dispose?(): void | Promise<void>;
}

/**
 * One prepared playable input. Core disposes it exactly once, after its track ends or when it is dropped before playback.
 */
export type PlaybackResource =
  | UrlPlaybackResource
  | FilePlaybackResource
  | StreamPlaybackResource
  | ReaderPlaybackResource
  | TimedPlaybackResource
  | EncodedPlaybackResource;

export type PlaybackResourceKind = PlaybackResource["kind"];

/** How a track ended. A playback failure rejects instead. */
export type TrackEnd = Readonly<{ reason: "finished" | "stopped" | "replaced" }>;

export interface TrackOptions {
  /** Aborting ends the track as `stopped`, including before it started. */
  readonly signal: AbortSignal;
  /** Called once when audio starts. */
  readonly onStart: () => void;
}

export interface SearchOptions {
  readonly signal: AbortSignal;
  /** Positive. A plugin clamps it to its own maximum. */
  readonly limit: number;
  /** Zero-based index of the first result. */
  readonly offset: number;
}

export interface RelatedOptions {
  readonly signal: AbortSignal;
  /** Recently played Songs the provider should avoid repeating. */
  readonly exclude: readonly Song[];
}

export interface ResolveOptions {
  readonly signal: AbortSignal;
  /** Return at most this many Songs in a Playlist and stop requesting provider pages once reached. */
  readonly maxPlaylistSongs: number;
}

/**
 * A media provider, an engine, or both. `Data` types the `pluginData` slot of every Song it returns, and `ListData`
 * that of every Playlist.
 *
 * A plugin has `name` and at least one of `resolve`, `search`, `stream` or `engine`. Core only passes Songs whose
 * `source` is this plugin's name. A thrown `DisTubeError` reaches the caller unchanged, except that
 * `INVALID_ARGUMENT`, `INVALID_STATE` and `ABORTED` without a caller abort become `SOURCE_FAILED` with the original
 * as `cause`. Any other throw becomes `SOURCE_FAILED` with `source` set to `name`.
 */
export interface Plugin<Data = unknown, ListData = unknown> {
  readonly name: string;
  /** Replaces the Adapter's built-in engine. At most one configured plugin carries one. */
  readonly engine?: Engine;
  /** Resolves a URL the plugin owns, or declines with `undefined`. */
  resolve?(url: string, options: ResolveOptions): Promise<Song<Data> | Playlist<Data, ListData> | undefined>;
  /** Provider-ranked results. An empty array declines. */
  search?(query: string, options: SearchOptions): Promise<readonly Song<Data>[]>;
  /**
   * A fresh resource for an owned Song. Without it, and without an engine `prepare`, core searches every other plugin
   * that has `search` and `stream` for the Song's name and artist and plays the first candidate that prepares.
   */
  stream?(song: Song<Data>, options: { readonly signal: AbortSignal }): Promise<PlaybackResource>;
  /** Autoplay continuation, or `undefined` to decline. */
  related?(song: Song<Data>, options: RelatedOptions): Promise<Song<Data> | undefined>;
  /** Completions for a partial query, at most 25 used. */
  suggest?(query: string, options: { readonly signal: AbortSignal }): Promise<readonly string[]>;
  dispose?(): void | Promise<void>;
}

/** The `Data` a Plugin instance declares, so `distube.search(q, { source })` types its results. */
export type PluginDataOf<Source> = Source extends Plugin<infer Data> ? Data : unknown;

/**
 * The playback backend for one voice session, created lazily for a guild's first queue item and released when the voice leaves.
 *
 * An operation the backend cannot perform rejects with `DisTubeError(UNSUPPORTED)`; core reports any
 * other rejection as `VOICE_FAILED`.
 */
export interface Player {
  /**
   * Source time, in seconds, of the audio the platform last played, or `0` without a track. A tempo preset changes how
   * fast it advances, not what it measures.
   */
  readonly position: number;
  /**
   * Plays `resource` unpaused, whatever the previous track's pause, replacing the current track, which settles
   * `replaced` first. Settles when the track ends.
   */
  play(resource: PlaybackResource, options: TrackOptions): Promise<TrackEnd>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Ends the active track as `stopped`, leaving the Player usable. */
  stopTrack(): Promise<void>;
  seek(seconds: number): Promise<void>;
  /** Percentage from 0 to 1000, kept for later tracks. */
  setVolume(percent: number): Promise<void>;
  /** Renders the ordered filter set; an empty list clears it. */
  setFilters(entries: readonly FilterEntry[]): Promise<void>;
  updateVoiceGateway?(gateway: VoiceGatewayData): Promise<void>;
  /**
   * Ends any active track as `stopped` and releases backend state once. Every call, concurrent, repeated or after
   * the Player closed on its own, settles from that one teardown; later `play` and controls reject.
   */
  release(): Promise<void>;
}

export interface PlayerOptions {
  /**
   * Called once with an Error when the Player closes on its own, such as when its native connection is destroyed,
   * before the Player rejects its pending `play`; core keeps using the Player until this call. The Player then
   * rejects that `play` and every later call other than `release`. Never called for `release`.
   */
  readonly onClosed: (error: Error) => void;
}

/** Gateway credentials an engine needs to attach to a voice connection. */
export interface VoiceGatewayData {
  readonly channelId: string;
  readonly sessionId: string;
  readonly token: string;
  readonly endpoint: string;
}

export type VoiceSessionEvent =
  /** The session settled on a channel. Republished whenever the gateway credentials change. */
  | Readonly<{ type: "connected"; channelId: string; gateway: VoiceGatewayData }>
  /**
   * The session ended, published at most once and never for `release`. `removed`: the platform removed the bot from
   * voice, such as a member disconnecting it. `failed`: the Adapter exhausted its recovery policy.
   */
  | Readonly<{ type: "disconnected"; reason: "removed" }>
  | Readonly<{ type: "disconnected"; reason: "failed"; error: Error }>;

/** The bot's own voice flags for `join` and `setSelfState`. An omitted flag keeps the current one. */
export interface JoinOptions {
  readonly selfDeaf?: boolean;
  readonly selfMute?: boolean;
}

export interface VoiceSessionOptions {
  readonly selfDeaf: boolean;
  readonly selfMute: boolean;
  readonly timeoutMs: number;
  /** Aborts when `voices.leave` or `dispose` supersedes the join; reject promptly and release what was created. */
  readonly signal?: AbortSignal;
}

/**
 * One guild's voice presence, owned by the Adapter, which also owns bounded recovery. Only a terminal disconnect
 * reaches core. `join`, `setSelfState`, `rejoin` and `release` run one at a time in call order.
 */
export interface VoiceSession {
  readonly guildId: string;
  readonly clientUserId: string;
  readonly channelId: string;
  /** The channel bitrate in bits per second. */
  readonly bitrate: number;
  /** Current credentials, or `undefined` until the first connection settles. */
  readonly gateway?: VoiceGatewayData;
  readonly selfDeaf: boolean;
  readonly selfMute: boolean;
  /** Joins or moves to `channelId`, sending the requested voice state; resolves after acknowledgement. */
  join(channelId: string, options?: JoinOptions): Promise<void>;
  /**
   * Changes only the flags, in the channel the session holds when the write runs; resolves after acknowledgement.
   * Never rebuilds the connection or publishes `connected`.
   */
  setSelfState(state: JoinOptions): Promise<void>;
  /**
   * Reports a Discord voice close code from a voice socket outside the Adapter, such as a remote engine's. The
   * session applies its own recovery policy. Does nothing after `release` started.
   */
  voiceClosed(code: number): void;
  /** Leaves and rejoins the current channel; resolves after the `connected` event with the fresh credentials. */
  rejoin(): Promise<void>;
  /** Leaves the channel once; every caller shares that completion. Later `join`, `setSelfState` and `rejoin` reject. */
  release(): Promise<void>;
  subscribe(listener: (event: VoiceSessionEvent) => void): () => void;
}

/**
 * One engine preset. `render` computes the engine-native payload; a preset that declares `default`,
 * `min` or `max` accepts a numeric value clamped to its range, otherwise it is fixed.
 */
export interface FilterDefinition<Payload = unknown> {
  readonly render: (value?: number) => Payload;
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
  /** Display name without the value, for `voice.filters.entries` and `distube.filters`; the preset name when absent. */
  readonly label?: string;
  /**
   * Source seconds this preset plays per wall second, or a function of the clamped value returning it, for an engine
   * that cannot read the rate from its payload. Finite and above 0.
   */
  readonly tempo?: number | ((value?: number) => number);
}

/** Preset name to definition, merged over an engine's built-in defaults. */
export type FilterDefinitions<Payload = unknown> = Readonly<Record<string, FilterDefinition<Payload>>>;

/** What an engine exposes about one merged preset. */
export interface FilterDefinitionInfo {
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
  /** Whether `voice.filters.set(name, value)` accepts a value for this preset. */
  readonly acceptsValue: boolean;
  /** Display name without the value. */
  readonly label: string;
}

/** One entry of a voice's ordered filter set. */
export interface FilterEntry {
  readonly name: string;
  /** Already clamped to the preset's range. */
  readonly value?: number;
}

/** The active playback backend: the Adapter's built-in engine, or the one engine plugin's. */
export interface Engine {
  readonly filters: ReadonlyMap<string, FilterDefinitionInfo>;
  createPlayer(session: VoiceSession, options: PlayerOptions): Promise<Player>;
  /**
   * Source seconds the ordered selection plays per wall second, as this engine composes it; finite and above 0.
   * Core calls it with the next selection before each filter change's Player command. Without it every selection
   * plays at 1.
   */
  playbackRate?(entries: readonly FilterEntry[]): number;
  /** When present, prepares every Song; core then calls no plugin's `stream` and runs no search fallback. */
  prepare?(song: Song, options: { readonly signal: AbortSignal }): Promise<PlaybackResource>;
}

/** Built-in engine settings from `DisTubeOptions`. */
export interface EngineSettings {
  readonly filters?: FilterDefinitions<string>;
  /** Opus encoder complexity, 0 to 10. */
  readonly opusComplexity: number;
  /** Read-ahead in milliseconds, a multiple of 20. */
  readonly bufferMs: number;
  /**
   * Delivers a diagnostic to `onDiagnostic` in a later microtask under its isolation rule. Returns without calling
   * the consumer and never throws, so the engine may call it from its audio path.
   */
  readonly report: (diagnostic: Diagnostic) => void;
}

/** The guild and voice channel a voice occupies, in platform-neutral IDs. */
export interface VoiceTarget {
  readonly guildId: string;
  readonly channelId: string;
}

export interface Adapter<Target = VoiceChannelTarget> {
  /** Pure synchronous conversion. A throw rejects the caller with `INVALID_ARGUMENT`. */
  normalizeTarget(target: Target): VoiceTarget;
  createVoiceSession(target: VoiceTarget, options: VoiceSessionOptions): Promise<VoiceSession>;
  /** The built-in engine, used unless a plugin carries one. */
  createEngine(settings: EngineSettings): Engine;
}
