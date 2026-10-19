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
  readonly error?: Error;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type PluginDiagnostic = Omit<Diagnostic, "plugin">;

export interface PluginContext {
  readonly diagnostic: (diagnostic: PluginDiagnostic) => void;
}

export interface SourceOperationOptions {
  readonly signal?: AbortSignal;
}

/**
 * Bounded pagination for `search`.
 *
 * Each SourcePlugin documents its own default and maximum `limit` and rejects a `limit` or `offset`
 * outside those bounds with `INVALID_ARGUMENT`. A plugin never returns more than the effective limit.
 */
export interface SearchOptions extends SourceOperationOptions {
  /** How many results to return at most. */
  readonly limit?: number;
  /** Zero-based index of the first result to return. */
  readonly offset?: number;
}

export type SuggestOptions = SourceOperationOptions;

export interface PlaybackContext {
  readonly signal: AbortSignal;
}

export interface RelatedContext {
  readonly signal: AbortSignal;
  /** Recently played Songs the provider should avoid repeating. */
  readonly exclude: readonly Song[];
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

export interface EncodedPlaybackResource {
  readonly kind: "encoded";
  readonly format: string;
  readonly encoded: string;
  readonly seekable?: boolean;
  dispose?(): void | Promise<void>;
}

/** One prepared playable input. Engines document which kinds their Players accept. */
export type PlaybackResource =
  | UrlPlaybackResource
  | FilePlaybackResource
  | StreamPlaybackResource
  | EncodedPlaybackResource;

export type PlaybackResourceKind = PlaybackResource["kind"];

/** Copied engine configuration; individual resources may impose narrower limits. */
export interface PlaybackCapabilities {
  readonly seek: boolean;
  readonly resourceKinds: readonly PlaybackResourceKind[];
  readonly encodedFormats: readonly string[];
}

export type PlaybackPreparation =
  | Readonly<{ kind: "resource"; resource: PlaybackResource }>
  | Readonly<{ kind: "search"; query: string }>;

/**
 * A media provider. `PluginData` types the `pluginData` slot of every Song it returns.
 *
 * `name` and `stream` are required, together with at least one of `resolve` or `search`.
 * A constructor validates options; provider requests begin on first use.
 */
export interface SourcePlugin<PluginData = unknown> {
  readonly name: string;
  /** Provider-ranked results for a query. An empty array declines; it is not an error. */
  search?(query: string, options?: SearchOptions): Promise<readonly Song<PluginData>[]>;
  /** Resolves an input the plugin owns, or declines with `undefined`. */
  resolve?(url: string, options?: SourceOperationOptions): Promise<Song<PluginData> | Playlist<PluginData> | undefined>;
  /** Prepares a Song this plugin owns: a fresh playback resource, or a query for another source to play. */
  stream(song: Song<PluginData>, context: PlaybackContext): Promise<PlaybackPreparation>;
  /** Autoplay continuation for a Song this plugin owns. An absent member is treated as a decline. */
  related?(song: Song<PluginData>, context: RelatedContext): Promise<Song<PluginData> | undefined>;
  /** Provider completions for a partial query, at most 25. An absent member or empty list declines. */
  suggest?(query: string, options?: SuggestOptions): Promise<readonly string[]>;
  initialize?(context: PluginContext): void;
  dispose?(): void | Promise<void>;
}

/** The `PluginData` a SourcePlugin instance declares, so `distube.search(q, { source })` types its results. */
export type PluginDataOf<Source> = Source extends SourcePlugin<infer PluginData> ? PluginData : unknown;

export type PlayerEvent =
  | Readonly<{ type: "finished"; itemId: string }>
  | Readonly<{ type: "failed"; itemId: string; error: Error; terminal?: true }>
  /** A terminal backend loss between tracks. It deliberately has no track outcome. */
  | Readonly<{ type: "terminal"; error: Error }>;

export interface PlaybackRequest {
  readonly itemId: string;
  readonly resource: PlaybackResource;
}

/**
 * The long-lived playback backend for one connected VoiceSession.
 *
 * DisTubeVoice is its only caller and owns its terminal release. A Player outlives the tracks it plays.
 *
 * A capability the backend does not perform, such as an `encoded` resource on a voice engine or a
 * filter it cannot render, SHALL reject with `DisTubeError(ErrorCode.UNSUPPORTED)`; every other
 * rejection is a backend failure and core reports it as `VOICE_FAILED`.
 */
export interface Player {
  /** Elapsed seconds of the active track, or `0` when no track is active. */
  readonly position: number;
  play(request: PlaybackRequest): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Ends the active track, leaving the Player and its voice connection usable. */
  stopTrack(): Promise<void>;
  seek(seconds: number): Promise<void>;
  /** Sets the playback volume as a percentage; the Player keeps it for later tracks. */
  setVolume(percent: number): Promise<void>;
  /**
   * Renders the ordered filter set as one native application, resolving preset names and folding
   * the entries itself. An empty list clears the Player's filter state.
   */
  setFilters(entries: readonly FilterEntry[]): Promise<void>;
  /** Terminally releases backend state. Overlapping callers share one completion. */
  release(): Promise<void>;
  /** Refreshes gateway credentials when the backend needs them. Local Players may omit this capability. */
  updateVoiceGateway?(gateway: VoiceGatewayData): Promise<void>;
  subscribe(listener: (event: PlayerEvent) => void): () => void;
}

/** Gateway credentials an engine needs to attach to a voice connection, carrying no native objects. */
export interface VoiceGatewayData {
  readonly channelId: string;
  readonly sessionId: string;
  readonly token: string;
  readonly endpoint: string;
}

export type VoiceSessionEvent =
  /** The session settled on a channel. Republished whenever the gateway credentials change. */
  | Readonly<{ type: "connected"; channelId: string; gateway: VoiceGatewayData }>
  /** The Adapter exhausted its recovery policy. Published exactly once per session. */
  | Readonly<{ type: "disconnected"; error?: Error }>;

/** The bot's own voice state sent with a join. An omitted flag keeps the current one; core defaults are self-deaf on and self-mute off. */
export interface JoinOptions {
  readonly selfDeaf?: boolean;
  readonly selfMute?: boolean;
}

/**
 * One guild's voice presence, owned by the Adapter.
 *
 * A session outlives the queues that play through it: recoverable connection changes are handled
 * inside the Adapter, and only a terminal disconnect reaches core.
 */
export interface VoiceSession {
  readonly guildId: string;
  /** The connected client's Discord user ID, for Engines that authenticate a backend session. */
  readonly clientUserId: string;
  /** The channel the session currently occupies. */
  readonly channelId: string;
  /** Current credentials, or `undefined` until the first connection settles. */
  readonly gateway?: VoiceGatewayData;
  readonly selfDeaf: boolean;
  readonly selfMute: boolean;
  /** Joins `channelId`, or moves an existing session without recreating it, sending the requested voice state. */
  join(channelId: string, options?: JoinOptions): Promise<void>;
  /** Updates the bot's self-deaf state for the current channel and resolves after acknowledgement. */
  setSelfDeaf(enabled: boolean): Promise<void>;
  /** Updates the bot's self-mute state for the current channel and resolves after acknowledgement. */
  setSelfMute(enabled: boolean): Promise<void>;
  /** Releases the connection. Overlapping callers share one teardown completion. */
  release(): Promise<void>;
  subscribe(listener: (event: VoiceSessionEvent) => void): () => void;
}

/**
 * One engine preset. `render` computes the engine-native payload; a preset that declares `default`,
 * `min` or `max` accepts a numeric value clamped to its range, otherwise it is fixed.
 */
export interface FilterDefinition<TPayload = unknown> {
  readonly render: (value?: number) => TPayload;
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
  /** Display text for `voice.filters.entries`; the preset name when absent. */
  readonly label?: string | ((value?: number) => string);
}

/** Construction-time `filters` option: preset name to definition, merged over an engine's built-in defaults. */
export type FilterDefinitions<TPayload = unknown> = Readonly<Record<string, FilterDefinition<TPayload>>>;

/** What an engine exposes about one merged preset, for command option building. */
export interface FilterDefinitionInfo {
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
  /** Whether `voice.filters.set(name, value)` accepts a value for this preset. */
  readonly acceptsValue: boolean;
  label(value?: number): string;
}

/** One entry of a voice's ordered filter set. Core keeps the order; the engine renders. */
export interface FilterEntry {
  readonly name: string;
  /** Numeric argument for a ranged preset, already clamped to its declared range. */
  readonly value?: number;
}

/**
 * The active playback backend: the Adapter's default voice engine, or the single engine-capable Plugin.
 *
 * The engine owns filter definitions, rendering, and folding; core only names filters and keeps them ordered.
 */
export interface Engine {
  /** Hooks are independently optional. Core owns each configured identity once, including dual-role objects. */
  readonly name?: string;
  initialize?(context: PluginContext): void;
  dispose?(): void | Promise<void>;

  /**
   * The PlaybackResource kinds this engine's Players accept.
   *
   * DisTubeVoice rejects any other kind with `UNSUPPORTED` before native playback starts. Bot code reads this
   * to know which sources an engine can play without waiting for a track to fail.
   */
  readonly accepts: ReadonlySet<PlaybackResource["kind"]>;
  /** Required when accepting encoded input; format identity prevents incompatible engines from borrowing it. */
  readonly encodedFormats?: ReadonlySet<string>;
  /** Pure synchronous option check after kind/format checks, before Player creation. Omit to accept all options. */
  supportsResource?(resource: PlaybackResource): boolean;
  /** What the engine's Players can do. DisTubeVoice rejects `seek` with `UNSUPPORTED` when `seek` is false. */
  readonly capabilities: Readonly<{ seek: boolean }>;
  /** Merged preset metadata by name. A name present here renders, or the report is wrong. */
  readonly filters: ReadonlyMap<string, FilterDefinitionInfo>;
  /** Creates the long-lived Player for a connected session. */
  createPlayer(session: VoiceSession): Promise<Player>;
}

/** The guild and voice channel a DisTubeVoice occupies, in platform-neutral IDs. */
export interface VoiceTarget {
  readonly guildId: string;
  readonly channelId: string;
}

export interface Adapter<Target = VoiceChannelTarget> {
  /**
   * Pure synchronous conversion. Core validates and copies these IDs before registering a queue; a throw
   * rejects the caller with INVALID_ARGUMENT carrying the thrown error as `cause`.
   */
  normalizeTarget(target: Target): VoiceTarget;
  /**
   * Validates channel capability and guild membership, then creates a gateway session joined to the target.
   * Audio transport and its prerequisites belong to the selected Engine.
   */
  createVoiceSession(target: VoiceTarget, options?: JoinOptions): Promise<VoiceSession>;
  /** The engine used unless an engine-capable Plugin is configured. */
  readonly engine?: Engine;
}

/** Structural engine detection, used for both the Adapter's default engine and engine-capable Plugins. */
export function isEngine(value: unknown): value is Engine {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<PropertyKey, unknown>>;
  return (
    typeof record.createPlayer === "function" &&
    isReadonlyCollection(record.accepts, "set") &&
    isReadonlyCollection(record.filters, "map") &&
    (record.encodedFormats === undefined || isReadonlyCollection(record.encodedFormats, "set")) &&
    (record.supportsResource === undefined || typeof record.supportsResource === "function") &&
    typeof record.capabilities === "object" &&
    record.capabilities !== null &&
    typeof (record.capabilities as Readonly<Record<string, unknown>>).seek === "boolean"
  );
}

/** A source has at least one discovery operation; every supplied member must be callable. */
export function isSourcePlugin(value: unknown): value is SourcePlugin {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<PropertyKey, unknown>>;
  return (
    typeof record.name === "string" &&
    typeof record.stream === "function" &&
    (typeof record.resolve === "function" || typeof record.search === "function") &&
    ["resolve", "search", "related", "suggest", "initialize", "dispose"].every(
      member => record[member] === undefined || typeof record[member] === "function",
    )
  );
}

function isReadonlyCollection(value: unknown, kind: "map" | "set"): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<PropertyKey, unknown>>;
  return (
    typeof record.size === "number" &&
    Number.isSafeInteger(record.size) &&
    record.size >= 0 &&
    [Symbol.iterator, "has", "keys", "values", "entries", "forEach", ...(kind === "map" ? ["get"] : [])].every(
      member => typeof record[member] === "function",
    )
  );
}
