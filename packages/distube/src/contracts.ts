import type { Playlist, Song } from "./media";

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

export interface Plugin {
  readonly name: string;
  initialize(context: PluginContext): void;
  dispose(): void | Promise<void>;
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

export interface PlaybackContext {
  readonly signal: AbortSignal;
}

export interface RelatedContext {
  readonly signal: AbortSignal;
}

export interface UrlPlaybackResource {
  readonly kind: "url";
  readonly url: string;
  dispose(): void | Promise<void>;
}

export interface EncodedPlaybackResource {
  readonly kind: "encoded";
  readonly encoded: string;
  dispose(): void | Promise<void>;
}

/** One prepared playable input. Engines document which kinds their Players accept. */
export type PlaybackResource = UrlPlaybackResource | EncodedPlaybackResource;

export type PlaybackPreparation =
  | Readonly<{ kind: "resource"; resource: PlaybackResource }>
  | Readonly<{ kind: "search"; query: string }>;

export interface SourcePlugin extends Plugin {
  /** Provider-ranked results for a query. An empty array declines; it is not an error. */
  search(query: string, options?: SearchOptions): Promise<readonly Song[]>;
  /** Resolves an input the plugin owns, or declines with `undefined`. */
  resolve(url: string, options?: SourceOperationOptions): Promise<Song | Playlist | undefined>;
  preparePlayback(song: Song, context: PlaybackContext): Promise<PlaybackPreparation>;
  /** Autoplay continuation for a Song this plugin owns. An absent member is treated as a decline. */
  related?(song: Song, context: RelatedContext): Promise<Song | undefined>;
}

export type PlayerEvent =
  | Readonly<{ type: "finished"; itemId: string }>
  | Readonly<{ type: "failed"; itemId: string; error: Error; terminal?: true }>
  /** A terminal backend loss between tracks. It deliberately has no QueueItem outcome. */
  | Readonly<{ type: "terminal"; error: Error }>;

export interface PlaybackRequest {
  readonly itemId: string;
  readonly resource: PlaybackResource;
}

/**
 * The long-lived playback backend for one connected VoiceSession.
 *
 * A Player outlives the tracks it plays and the queues that borrow it. Voice owns its terminal release.
 *
 * A capability the backend does not perform — seek or an `encoded` resource on a voice engine, a
 * filter it cannot render — SHALL reject with `DisTubeError(ErrorCode.UNSUPPORTED)`; every other
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
  readonly sessionId: string;
  readonly token: string;
  readonly endpoint: string;
}

export type VoiceSessionEvent =
  /** The session settled on a channel. Republished whenever the gateway credentials change. */
  | Readonly<{ type: "connected"; channelId: string; gateway: VoiceGatewayData }>
  /** The Adapter exhausted its recovery policy. Published exactly once per session. */
  | Readonly<{ type: "disconnected"; error?: Error }>;

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
  /** Joins `channelId`, or moves an existing session without recreating it. */
  join(channelId: string): Promise<void>;
  /** Releases the connection. Overlapping callers share one teardown completion. */
  release(): Promise<void>;
  subscribe(listener: (event: VoiceSessionEvent) => void): () => void;
}

/** A preset definition: a complete engine-native payload, or a calculation from the entry's value. */
export type FilterDefinition<TPayload = unknown> = TPayload | ((value?: number) => TPayload);

/** Construction-time `filters` option: preset name to definition, merged over an engine's built-in defaults. */
export type FilterDefinitions<TPayload = unknown> = Readonly<Record<string, FilterDefinition<TPayload>>>;

/** One entry of a queue's ordered filter set. Core keeps the order and treats `payload` as opaque. */
export interface FilterEntry<TPayload = unknown> {
  readonly name: string;
  /** Numeric argument handed to a calculation-form preset. */
  readonly value?: number;
  /** Ad hoc engine-native payload supplied through `set(name, payload)` instead of a preset. */
  readonly payload?: TPayload;
}

/**
 * The active playback backend: the Adapter's default voice engine, or the single engine-capable Plugin.
 *
 * The engine owns filter definitions, rendering, and folding; core only names filters and keeps them ordered.
 */
export interface Engine {
  /**
   * The PlaybackResource kinds this engine's Players accept.
   *
   * A Player rejects any other kind with `UNSUPPORTED` before native playback starts. Bot code reads this
   * to know which sources an engine can play without waiting for a track to fail.
   */
  readonly accepts: ReadonlySet<PlaybackResource["kind"]>;
  /** Creates the long-lived Player for a connected session. */
  createPlayer(session: VoiceSession): Promise<Player>;
  /** Whether the engine can render `name` as a preset. A name reported here renders, or the report is wrong. */
  resolvable(name: string): boolean;
}

export interface QueueBinding {
  readonly queueId: string;
  readonly guildId: string;
}

/** The guild and voice channel a Voice occupies, in platform-neutral IDs. */
export interface VoiceTarget {
  readonly guildId: string;
  readonly channelId: string;
}

export interface Adapter {
  /**
   * Validates `target` and completes Adapter-owned prerequisite preflight before native gateway work,
   * then creates the guild's session already joined to `target.channelId`.
   */
  createVoiceSession(target: VoiceTarget): Promise<VoiceSession>;
  /** The engine used unless an engine-capable Plugin is configured. */
  readonly engine: Engine;
}

/** Structural engine detection, used for both the Adapter's default engine and engine-capable Plugins. */
export function isEngine(value: unknown): value is Engine {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Readonly<Record<PropertyKey, unknown>>;
  return (
    typeof record.createPlayer === "function" &&
    typeof record.resolvable === "function" &&
    record.accepts instanceof Set
  );
}

export function isSourcePlugin(plugin: Plugin): plugin is SourcePlugin {
  const candidate: unknown = plugin;
  if (typeof candidate !== "object" || candidate === null) return false;
  const record = candidate as Readonly<Record<PropertyKey, unknown>>;
  return (
    typeof record.resolve === "function" &&
    typeof record.search === "function" &&
    typeof record.preparePlayback === "function"
  );
}
