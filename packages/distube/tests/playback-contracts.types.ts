import type { DisTube, DisTubeGuild, DisTubeVoice, PlayResult, QueueItem, VoiceManager } from "../src";
import { Song } from "../src";
import type {
  EncodedPlaybackResource,
  Engine,
  FilterDefinitions,
  FilterEntry,
  PlaybackContext,
  PlaybackPreparation,
  PlaybackRequest,
  Player,
  PlayerEvent,
  PluginContext,
  SourceOperationOptions,
  SourcePlugin,
  UrlPlaybackResource,
  VoiceSession,
  VoiceSessionEvent,
} from "../src/integrations";

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

const song = new Song({
  id: "song",
  name: "Song",
  url: "https://provider.example/song",
  duration: 1,
  source: "source",
});
declare const item: QueueItem;
// @ts-expect-error QueueItem identity is core-owned
queue.enqueue(song, { id: "caller-owned" });
// @ts-expect-error QueueItem insertion time is core-owned
queue.enqueue(song, { addedAt: new Date(0) });

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

const idleTerminal: PlayerEvent = { type: "terminal", error: new Error("backend lost") };

// @ts-expect-error retired Player input cannot receive QueueItem
player.play(item);

const session: VoiceSession = {
  guildId: "guild",
  clientUserId: "bot",
  channelId: "voice",
  async join(_channelId: string): Promise<void> {},
  async release(): Promise<void> {},
  subscribe(_listener: (event: VoiceSessionEvent) => void): () => void {
    return () => undefined;
  },
};

const engine: Engine = {
  accepts: new Set(["url" as const]),
  async createPlayer(_session: VoiceSession): Promise<Player> {
    return player;
  },
  resolvable(_name: string): boolean {
    return true;
  },
};

declare const resultQueue: PlayResult["queue"];
declare const queue: DisTubeGuild;
declare const distubeVoices: DisTube["voices"];
declare const voices: VoiceManager;
declare const voice: DisTubeVoice;
const returnedQueue: DisTubeGuild = resultQueue;
const voiceFilters = voice.settings.filters;
const publicVoices: VoiceManager = distubeVoices;
const managedVoice: DisTubeVoice | undefined = voices.get("guild");

// @ts-expect-error DisTubeGuild is a type-only facade
new DisTubeGuild({ queueId: "queue", guildId: "guild" }, {} as never, {} as never, {} as never);
// @ts-expect-error DisTubeVoice is a type-only facade
new DisTubeVoice({} as never, {} as never, {} as never);
// @ts-expect-error VoiceManager is a type-only facade
new VoiceManager({} as never, {} as never, {} as never);

// @ts-expect-error DisTubeGuild has no runtime constructor
queue instanceof DisTubeGuild;
// @ts-expect-error DisTubeVoice has no runtime constructor
voice instanceof DisTubeVoice;
// @ts-expect-error VoiceManager has no runtime constructor
voices instanceof VoiceManager;

// @ts-expect-error DisTubeGuild has no channel authority
queue.channelId;
// @ts-expect-error playback settings live on the guild's DisTubeVoice
queue.volume;
// @ts-expect-error playback settings live on the guild's DisTubeVoice
queue.repeatMode;
// @ts-expect-error playback settings live on the guild's DisTubeVoice
queue.autoplay;
// @ts-expect-error playback settings live on the guild's DisTubeVoice
queue.setVolume(50);
// @ts-expect-error playback settings live on the guild's DisTubeVoice
queue.setRepeatMode(0);
// @ts-expect-error playback settings live on the guild's DisTubeVoice
queue.setAutoplay(true);
// @ts-expect-error playback settings live on the guild's DisTubeVoice
queue.filters;
// @ts-expect-error playback settings live on the guild's DisTubeVoice
queue.previousSongs;
// @ts-expect-error DisTubeGuild deletion is internal
queue.destroy();
// @ts-expect-error DisTubeVoice release state is internal
voice.released;
// @ts-expect-error DisTubeVoice Player access is internal
voice.player();
// @ts-expect-error DisTubeVoice Player retirement is internal
voice.retire(player);
// @ts-expect-error DisTubeVoice release is internal
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
new Song({ id: "leak", name: "Leak", url: "https://provider.example/leak", duration: 1, source: "source", resource });
// @ts-expect-error QueueItem cannot carry a playback resource
queue.enqueue(song, { resource });

interface Requester {
  readonly requestedBy: string;
}
declare const typed: DisTube<Requester>;
declare const untyped: DisTube;

// The declared shape reaches every hand-back without a cast, assertion, or narrowing.
const typedFromPlay: Promise<Requester> = typed
  .play({ guildId: "guild", id: "voice" }, "query", { metadata: { requestedBy: "skick" } })
  .then(result => result.items[0]?.metadata ?? { requestedBy: "" });
const typedFromQueue: string | undefined = typed.getQueue("guild")?.state.current?.metadata?.requestedBy;
typed.on("queue.item.added", event => event.item.metadata?.requestedBy);

// @ts-expect-error metadata of the wrong shape fails before it can run
typed.play({ guildId: "guild", id: "voice" }, "query", { metadata: { requester: "skick" } });
// @ts-expect-error the same contract applies to enqueue
typed.getQueue("guild")?.enqueue("query", { metadata: {} });
// @ts-expect-error an omitted type parameter leaves metadata unknown, so a property read needs narrowing
untyped.getQueue("guild")?.state.current?.metadata?.requestedBy;
// Any value is still accepted when the parameter is omitted.
untyped.play({ guildId: "guild", id: "voice" }, "query", { metadata: Symbol("anything") });

void [typedFromPlay, typedFromQueue];

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
  idleTerminal,
  session,
  engine,
  returnedQueue,
  voiceFilters,
  publicVoices,
  managedVoice,
  definitions,
  entries,
];

// @ts-expect-error caller metadata binding is readonly
item.metadata = {};
// @ts-expect-error native voice channels identify their channel with id
untyped.play({ guildId: "guild", voiceChannelId: "voice" }, "query");
// @ts-expect-error playback URLs belong to integration resources, not Songs
song.resource;
// @ts-expect-error provider-specific metadata remains source-owned
song.metadata;
// @ts-expect-error queue state exposes upcoming occurrences, not a mutable internal list
queue.state.items;
// @ts-expect-error enqueue targets are occurrence IDs, not positions
queue.remove(0);
