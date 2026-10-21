import type { Readable } from "node:stream";
import type { Playlist, Song } from "./media";
import type { VoiceChannelTarget } from "./voice/target";

/** What core accepts wherever media enters the client. */
export type ResolvableInput = string | Song | Playlist;

export type DiagnosticSeverity = "debug" | "info" | "warning" | "error";

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly stage: string;
  readonly message: string;
  readonly plugin?: string;
  readonly error?: unknown;
}

export interface UrlPlaybackResource {
  readonly kind: "url";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly seekable?: boolean;
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

/** Byte-addressable media the engine seeks through the container index. */
export interface ReaderPlaybackResource {
  readonly kind: "reader";
  readonly size: number;
  readonly container: "webm" | "mp4";
  /** Returns bytes `start` through `end` inclusive; `signal` aborts when the engine no longer needs them. */
  read(start: number, end: number, signal: AbortSignal): Readable;
  dispose?(): void | Promise<void>;
}

/** Media that can only start at a time; `open` returns the container header, then media from at or before `seconds`. */
export interface TimedPlaybackResource {
  readonly kind: "timed";
  readonly container: "webm" | "mp4";
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
 * One prepared playable input. Whoever receives it disposes it exactly once: `DisTubeVoice.play` after the
 * track ends, or core when a prepared resource is dropped before playback.
 */
export type PlaybackResource =
  | UrlPlaybackResource
  | FilePlaybackResource
  | StreamPlaybackResource
  | ReaderPlaybackResource
  | TimedPlaybackResource
  | EncodedPlaybackResource;

export type PlaybackResourceKind = PlaybackResource["kind"];

/** A resource to play, or a query core searches the other plugins for. */
export type PlaybackPreparation =
  | Readonly<{ kind: "resource"; resource: PlaybackResource }>
  | Readonly<{ kind: "search"; query: string }>;

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

export interface PrepareContext {
  readonly signal: AbortSignal;
  /** Calls the owning plugin's `stream` on demand. Absent when the owner is the engine plugin or cannot stream. */
  readonly stream?: () => Promise<PlaybackPreparation>;
}

/**
 * A media provider, an engine, or both. `Data` types the `pluginData` slot of every Song it returns.
 *
 * A plugin has `name` and at least one of `resolve`, `search` or `engine`. Core only passes Songs whose
 * `source` is this plugin's name. A thrown `DisTubeError` reaches the caller unchanged; any other throw
 * becomes `SOURCE_FAILED` with `source` set to `name`.
 */
export interface Plugin<Data = unknown> {
  readonly name: string;
  /** Replaces the Adapter's built-in engine. At most one configured plugin carries one. */
  readonly engine?: Engine;
  /** Resolves a URL the plugin owns, or declines with `undefined`. */
  resolve?(url: string, options: { readonly signal: AbortSignal }): Promise<Song<Data> | Playlist<Data> | undefined>;
  /** Provider-ranked results. An empty array declines. */
  search?(query: string, options: SearchOptions): Promise<readonly Song<Data>[]>;
  /** Required for plugins that return Songs, unless an engine plugin prepares every Song. */
  stream?(song: Song<Data>, options: { readonly signal: AbortSignal }): Promise<PlaybackPreparation>;
  /** Autoplay continuation, or `undefined` to decline. */
  related?(song: Song<Data>, options: RelatedOptions): Promise<Song<Data> | undefined>;
  /** Completions for a partial query, at most 25 used. */
  suggest?(query: string, options: { readonly signal: AbortSignal }): Promise<readonly string[]>;
  dispose?(): void | Promise<void>;
}

/** The `Data` a Plugin instance declares, so `distube.search(q, { source })` types its results. */
export type PluginDataOf<Source> = Source extends Plugin<infer Data> ? Data : unknown;

/**
 * The playback backend for one voice session, created lazily by DisTubeVoice and released with it.
 *
 * An operation the backend cannot perform rejects with `DisTubeError(UNSUPPORTED)`; core reports any
 * other rejection as `VOICE_FAILED`.
 */
export interface Player {
  /** Elapsed seconds of the active track, or `0`. */
  readonly position: number;
  /** Plays `resource`, replacing the current track, which settles `replaced` first. Settles when the track ends. */
  play(resource: PlaybackResource, options: TrackOptions): Promise<TrackEnd>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Ends the active track as `stopped`, leaving the Player usable. */
  stopTrack(): Promise<void>;
  seek(seconds: number): Promise<void>;
  /** Percentage, kept for later tracks. */
  setVolume(percent: number): Promise<void>;
  /** Renders the ordered filter set; an empty list clears it. */
  setFilters(entries: readonly FilterEntry[]): Promise<void>;
  /** Target encode bitrate in bits per second; `undefined` follows `session.bitrate`. */
  setBitrate?(bitrate: number | undefined): Promise<void>;
  updateVoiceGateway?(gateway: VoiceGatewayData): Promise<void>;
  /** Ends any active track as `stopped` and releases backend state. */
  release(): Promise<void>;
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
  /** The Adapter exhausted its recovery policy. Published at most once per session. */
  | Readonly<{ type: "disconnected"; error?: Error }>;

/** The bot's own voice state sent with a join. An omitted flag keeps the current one. */
export interface JoinOptions {
  readonly selfDeaf?: boolean;
  readonly selfMute?: boolean;
}

export interface VoiceSessionOptions {
  readonly selfDeaf: boolean;
  readonly selfMute: boolean;
  readonly timeoutMs: number;
}

/** One guild's voice presence, owned by the Adapter. Only a terminal disconnect reaches core. */
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
  /** Display text for `voice.filters.entries`; the preset name when absent. */
  readonly label?: string | ((value?: number) => string);
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
  label(value?: number): string;
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
  createPlayer(session: VoiceSession): Promise<Player>;
  /** When present, prepares every Song in place of the owning plugin's `stream`. */
  prepare?(song: Song, context: PrepareContext): Promise<PlaybackResource>;
}

/** Built-in engine settings from `DisTubeOptions`. */
export interface EngineSettings {
  readonly filters?: FilterDefinitions<string>;
  /** Opus encoder complexity, 0 to 10. */
  readonly opusComplexity: number;
  /** Read-ahead in milliseconds, a multiple of 20. */
  readonly bufferMs: number;
}

/** The guild and voice channel a DisTubeVoice occupies, in platform-neutral IDs. */
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
