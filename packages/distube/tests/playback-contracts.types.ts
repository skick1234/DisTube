import {
  type DisTube,
  type EncodedPlaybackResource,
  type Engine,
  type FilterDefinitions,
  type FilterEntry,
  GuildQueue,
  type PlaybackContext,
  type PlaybackPreparation,
  type PlaybackRequest,
  type Player,
  type PlayerEvent,
  type PlayResult,
  type PluginContext,
  // @ts-expect-error v6 has no Plugin roles or registry contract
  type PluginRegistry,
  QueueFilters,
  QueueItem,
  Song,
  type SourceOperationOptions,
  type SourcePlugin,
  type UrlPlaybackResource,
  Voice,
  VoiceManager,
  type VoiceSession,
  type VoiceSessionEvent,
} from "../src";

const resource: UrlPlaybackResource = {
  kind: "url",
  url: "https://stream.example/audio",
  dispose: () => undefined,
};
const encoded: EncodedPlaybackResource = {
  kind: "encoded",
  encoded: "QAAAjQIAJVJpY2sgQXN0bGV5",
  dispose: () => undefined,
};
const request: PlaybackRequest = { itemId: "item", resource };
const encodedRequest: PlaybackRequest = { itemId: "item", resource: encoded };
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
  position: 0,
  async play(_request: PlaybackRequest): Promise<void> {},
  async pause(): Promise<void> {},
  async resume(): Promise<void> {},
  async stopTrack(): Promise<void> {},
  async seek(_seconds: number): Promise<void> {},
  async setVolume(_percent: number): Promise<void> {},
  async setFilters(_entries: readonly FilterEntry[]): Promise<void> {},
  async release(): Promise<void> {},
  subscribe(_listener: (event: PlayerEvent) => void): () => void {
    return () => undefined;
  },
};

// @ts-expect-error retired Player input cannot receive QueueItem
player.play(item);

const session: VoiceSession = {
  guildId: "guild",
  channelId: "voice",
  async join(_channelId: string): Promise<void> {},
  async release(): Promise<void> {},
  subscribe(_listener: (event: VoiceSessionEvent) => void): () => void {
    return () => undefined;
  },
};

const engine: Engine = {
  async createPlayer(_session: VoiceSession): Promise<Player> {
    return player;
  },
  resolvable(_name: string): boolean {
    return true;
  },
};

declare const resultQueue: PlayResult["queue"];
declare const queue: GuildQueue;
declare const distubeVoices: DisTube["voices"];
declare const voices: VoiceManager;
declare const voice: Voice;
const returnedQueue: GuildQueue = resultQueue;
const queueFilters: QueueFilters = queue.filters;
const publicVoices: VoiceManager = distubeVoices;
const managedVoice: Voice | undefined = voices.get("guild");

// @ts-expect-error GuildQueue is a type-only facade
new GuildQueue({ queueId: "queue", guildId: "guild" }, {} as never, {} as never, {} as never, {} as never);
// @ts-expect-error QueueFilters is a type-only facade
new QueueFilters({} as never, {} as never);
// @ts-expect-error Voice is a type-only facade
new Voice({} as never, {} as never, {} as never);
// @ts-expect-error VoiceManager is a type-only facade
new VoiceManager({} as never, {} as never, {} as never);

// @ts-expect-error GuildQueue has no runtime constructor
queue instanceof GuildQueue;
// @ts-expect-error QueueFilters has no runtime constructor
queue.filters instanceof QueueFilters;
// @ts-expect-error Voice has no runtime constructor
voice instanceof Voice;
// @ts-expect-error VoiceManager has no runtime constructor
voices instanceof VoiceManager;

// @ts-expect-error GuildQueue has no channel authority
queue.channelId;
// @ts-expect-error GuildQueue deletion is internal
queue.destroy();
// @ts-expect-error Voice release state is internal
voice.released;
// @ts-expect-error Voice Player access is internal
voice.player();
// @ts-expect-error Voice Player retirement is internal
voice.retire(player);
// @ts-expect-error Voice release is internal
voice.release();
// @ts-expect-error VoiceManager borrowing is internal
voices.borrow({ guildId: "guild", channelId: "voice" });
// @ts-expect-error VoiceManager fencing is internal
voices.fence();
// @ts-expect-error VoiceManager bulk release is internal
voices.releaseAll();

const definitions: FilterDefinitions<string> = {
  nightcore: "asetrate=48000*1.25",
  bassboost: (value = 1) => `bass=g=${value}`,
};
const entries: readonly FilterEntry[] = [
  { name: "nightcore" },
  { name: "bass", value: 3 },
  { name: "raw", payload: 1 },
];

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
// @ts-expect-error encoded playback resources require dispose
const missingEncodedDisposal: EncodedPlaybackResource = { kind: "encoded", encoded: "QAAAjQIA" };
// @ts-expect-error a playback resource carries exactly one payload discriminant
const mixed: EncodedPlaybackResource = { kind: "encoded", encoded: "x", url: "https://a.example", dispose() {} };
// @ts-expect-error Song cannot carry a playback resource
new Song({ id: "leak", title: "Leak", url: "https://provider.example/leak", duration: 1, source: "source", resource });
// @ts-expect-error QueueItem cannot carry a playback resource
new QueueItem({ song, resource });

void [
  request,
  encodedRequest,
  options,
  context,
  fallback,
  source,
  legacySource,
  missingDisposal,
  malformedResource,
  missingEncodedDisposal,
  mixed,
  removedRegistry,
  session,
  engine,
  returnedQueue,
  queueFilters,
  publicVoices,
  managedVoice,
  definitions,
  entries,
];
