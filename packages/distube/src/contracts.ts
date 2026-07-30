import type { Song } from "./media";

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

export interface PlaybackContext {
  readonly signal: AbortSignal;
}

export interface UrlPlaybackResource {
  readonly kind: "url";
  readonly url: string;
  dispose(): void | Promise<void>;
}

export type PlaybackPreparation =
  | Readonly<{ kind: "resource"; resource: UrlPlaybackResource }>
  | Readonly<{ kind: "search"; query: string }>;

export interface SourcePlugin extends Plugin {
  search(query: string, options?: SourceOperationOptions): Promise<readonly Song[]>;
  resolve(url: string, options?: SourceOperationOptions): Promise<Song | readonly Song[] | undefined>;
  preparePlayback(song: Song, context: PlaybackContext): Promise<PlaybackPreparation>;
}

export type PlayerEvent =
  | Readonly<{ type: "finished"; itemId: string }>
  | Readonly<{ type: "failed"; itemId: string; error: Error; terminal?: true }>;

export interface PlaybackRequest {
  readonly itemId: string;
  readonly resource: UrlPlaybackResource;
}

export interface Player {
  play(request: PlaybackRequest): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  seek(seconds: number): Promise<void>;
  subscribe(listener: (event: PlayerEvent) => void): () => void;
}

export interface QueueBinding {
  readonly queueId: string;
  readonly guildId: string;
  readonly channelId: string;
}

export interface CreateQueueOptions {
  readonly guildId: string;
  readonly channelId: string;
}

export interface Adapter {
  createPlayer(binding: QueueBinding): Promise<Player>;
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
