import {
  type PlaybackContext,
  type PlaybackPreparation,
  type PlaybackRequest,
  type Player,
  type PlayerEvent,
  type PluginContext,
  // @ts-expect-error v6 has no Plugin roles or registry contract
  type PluginRegistry,
  QueueItem,
  Song,
  type SourceOperationOptions,
  type SourcePlugin,
  type UrlPlaybackResource,
} from "../src";

const resource: UrlPlaybackResource = {
  kind: "url",
  url: "https://stream.example/audio",
  dispose: () => undefined,
};
const request: PlaybackRequest = { itemId: "item", resource };
const options: SourceOperationOptions = { signal: new AbortController().signal };
const context: PlaybackContext = { signal: new AbortController().signal };
const direct: PlaybackPreparation = { kind: "resource", resource };
const fallback: PlaybackPreparation = { kind: "search", query: "title artist" };
type RemovedRegistry = PluginRegistry;
const removedRegistry: RemovedRegistry | undefined = undefined;

const song = new Song({
  id: "song",
  title: "Song",
  url: "https://provider.example/song",
  duration: 1,
  source: "source",
});
const item = new QueueItem({ song });
// @ts-expect-error QueueItem identity is core-owned
new QueueItem({ song, id: "caller-owned" });
// @ts-expect-error QueueItem insertion time is core-owned
new QueueItem({ song, addedAt: new Date(0) });

const source: SourcePlugin = {
  name: "source",
  initialize(_pluginContext: PluginContext): void {},
  dispose(): void {},
  async search(_query: string, _options?: SourceOperationOptions): Promise<readonly Song[]> {
    return [song];
  },
  async resolve(_url: string, _options?: SourceOperationOptions): Promise<Song> {
    return song;
  },
  async preparePlayback(_song: Song, _context: PlaybackContext): Promise<PlaybackPreparation> {
    return direct;
  },
};

const player: Player = {
  async play(_request: PlaybackRequest): Promise<void> {},
  async pause(): Promise<void> {},
  async resume(): Promise<void> {},
  async stop(): Promise<void> {},
  async seek(_seconds: number): Promise<void> {},
  subscribe(_listener: (event: PlayerEvent) => void): () => void {
    return () => undefined;
  },
};

// @ts-expect-error retired Player input cannot receive QueueItem
player.play(item);

// @ts-expect-error SourcePlugin preparation is mandatory
const legacySource: SourcePlugin = {
  name: "legacy",
  initialize(): void {},
  dispose(): void {},
  async search(): Promise<readonly Song[]> {
    return [];
  },
  async resolve(): Promise<undefined> {
    return undefined;
  },
};

// @ts-expect-error URL playback resources require dispose
const missingDisposal: UrlPlaybackResource = { kind: "url", url: "https://stream.example/audio" };
// @ts-expect-error URL playback resources support only the url discriminant
const malformedResource: UrlPlaybackResource = { kind: "stream", url: "https://stream.example/audio", dispose() {} };
// @ts-expect-error Song cannot carry a playback resource
new Song({ id: "leak", title: "Leak", url: "https://provider.example/leak", duration: 1, source: "source", resource });
// @ts-expect-error QueueItem cannot carry a playback resource
new QueueItem({ song, resource });

void [request, options, context, fallback, source, legacySource, missingDisposal, malformedResource, removedRegistry];
