import type { QueueItem, Song } from "./media";

export interface PluginContext {
  readonly diagnostic: (message: string, detail?: unknown) => void;
}

export interface Plugin {
  readonly name: string;
  initialize(context: PluginContext): void;
  dispose(): void | Promise<void>;
}

export interface SourcePlugin extends Plugin {
  search(query: string): Promise<readonly Song[]>;
  resolve(url: string): Promise<Song | readonly Song[] | undefined>;
}

export type PlayerEvent =
  | Readonly<{ type: "finished"; itemId: string }>
  | Readonly<{ type: "failed"; itemId: string; error: Error }>;

export interface Player {
  play(item: QueueItem): Promise<void>;
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
  const candidate = plugin as Partial<SourcePlugin>;
  return typeof candidate.resolve === "function" && typeof candidate.search === "function";
}
