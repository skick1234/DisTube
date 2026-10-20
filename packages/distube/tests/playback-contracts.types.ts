import { expectTypeOf } from "vitest";
import type {
  DisTube,
  DisTubeQueue,
  DisTubeVoice,
  PlaybackCapabilities,
  QueueItem,
  QueueState,
  VoiceManager,
} from "../src";
import { Song } from "../src";
import type {
  EncodedPlaybackResource,
  Engine,
  FilePlaybackResource,
  FilterDefinitionInfo,
  FilterDefinitions,
  FilterEntry,
  JoinOptions,
  PlaybackContext,
  PlaybackPreparation,
  PlaybackRequest,
  Player,
  PlayerEvent,
  PluginContext,
  ReaderPlaybackResource,
  SourceOperationOptions,
  SourcePlugin,
  StreamPlaybackResource,
  TimedPlaybackResource,
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
  format: "test.encoded",
  encoded: "QAAAjQIAJVJpY2sgQXN0bGV5",
  dispose: () => undefined,
};
const file: FilePlaybackResource = { kind: "file", path: "/tmp/clip.opus" };
declare const audio: StreamPlaybackResource["stream"];
const stream: StreamPlaybackResource = { kind: "stream", stream: audio };
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
queue.add(song, { id: "caller-owned" });
// @ts-expect-error QueueItem insertion time is core-owned
queue.add(song, { addedAt: new Date(0) });

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
  async stream(_song: Song, _context: PlaybackContext): Promise<PlaybackPreparation> {
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
  selfDeaf: true,
  selfMute: false,
  async join(_channelId: string, _options?: JoinOptions): Promise<void> {},
  async setSelfDeaf(_enabled: boolean): Promise<void> {},
  async setSelfMute(_enabled: boolean): Promise<void> {},
  async release(): Promise<void> {},
  subscribe(_listener: (event: VoiceSessionEvent) => void): () => void {
    return () => undefined;
  },
};

// @ts-expect-error a VoiceSession must implement the self-deaf and self-mute updates
const legacySession: VoiceSession = {
  guildId: "guild",
  clientUserId: "bot",
  channelId: "voice",
  async join(_channelId: string): Promise<void> {},
  async release(): Promise<void> {},
  subscribe(): () => void {
    return () => undefined;
  },
};

const info: FilterDefinitionInfo = { default: 10, min: 0, max: 20, acceptsValue: true, label: () => "Bass" };
const engine: Engine = {
  accepts: new Set(["url" as const]),
  capabilities: { seek: true },
  filters: new Map([["bassboost", info]]),
  async createPlayer(_session: VoiceSession): Promise<Player> {
    return player;
  },
};

const legacyEngine: Engine = {
  accepts: new Set(["url" as const]),
  capabilities: { seek: false },
  filters: new Map(),
  async createPlayer(): Promise<Player> {
    return player;
  },
  // @ts-expect-error resolvable is gone; filter metadata comes from `filters`
  resolvable(): boolean {
    return true;
  },
};

declare const resultQueue: Awaited<ReturnType<DisTube["play"]>>;
declare const queue: DisTubeQueue;
declare const distubeVoices: DisTube["voices"];
declare const voices: VoiceManager;
declare const voice: DisTubeVoice;
const returnedQueue: DisTubeQueue = resultQueue;
const voiceFilters: readonly string[] = voice.filters.names;
const voiceState: [number, boolean, boolean] = [voice.volume, voice.selfDeaf, voice.selfMute];
const publicVoices: VoiceManager = distubeVoices;
const managedVoice: DisTubeVoice | undefined = voices.get("guild");
const joined: Promise<DisTubeVoice> = voices.join({ guildId: "guild", id: "voice" }, { selfDeaf: false });
const played: Promise<void> = voice.play(resource, { itemId: "clip" });
const attachedVoice: DisTubeVoice | undefined = queue.voice;
const capabilities: PlaybackCapabilities = voice.capabilities;
const seekable: boolean = voice.seekable;

// @ts-expect-error DisTubeQueue has no channel authority
queue.channelId;
// @ts-expect-error volume lives on the guild's DisTubeVoice
queue.volume;
// @ts-expect-error volume lives on the guild's DisTubeVoice
queue.setVolume(50);
// @ts-expect-error filters live on the guild's DisTubeVoice
queue.filters;
// @ts-expect-error the schedule is read through current, upcoming and history
queue.state;
// @ts-expect-error DisTubeQueue deletion is internal
queue.destroy();
// @ts-expect-error repeat and autoplay moved to the queue
voice.setRepeat("song");
// @ts-expect-error repeat and autoplay moved to the queue
voice.setAutoplay(true);
// @ts-expect-error whole-set filter replacement was removed in favour of the manager
voice.filters(["bassboost"]);
// @ts-expect-error the old settings bag no longer exists
voice.settings;
// @ts-expect-error DisTubeVoice release state is internal
voice.released;
// @ts-expect-error DisTubeVoice attachment is internal
voice.attach(queue);
// @ts-expect-error DisTubeVoice release is internal
voice.release();
// @ts-expect-error VoiceManager fencing is internal
voices.fence();
// @ts-expect-error VoiceManager bulk release is internal
voices.releaseAll();

const definitions: FilterDefinitions<string> = {
  nightcore: { render: () => "asetrate=48000*1.25", label: "Nightcore" },
  bassboost: { render: (value = 10) => `bass=g=${value}`, default: 10, min: 0, max: 20, label: v => `Bass +${v}dB` },
};
// @ts-expect-error a definition is an object with render, never a bare payload
const legacyDefinitions: FilterDefinitions<string> = { nightcore: "asetrate=48000*1.25" };
const entries: readonly FilterEntry[] = [{ name: "nightcore" }, { name: "bass", value: 3 }];
// @ts-expect-error ad hoc payloads are gone; presets are configured at construction
const rawEntry: FilterEntry = { name: "raw", payload: 1 };

// @ts-expect-error SourcePlugin streaming is mandatory
const legacySource: SourcePlugin = {
  name: "legacy",
  async search(): Promise<readonly Song[]> {
    return [];
  },
  async resolve(): Promise<undefined> {
    return undefined;
  },
};

const withoutDisposer: UrlPlaybackResource = { kind: "url", url: "https://stream.example/audio" };
// @ts-expect-error URL playback resources support only the url discriminant
const malformedResource: UrlPlaybackResource = { kind: "stream", url: "https://stream.example/audio", dispose() {} };
// @ts-expect-error encoded playback resources require a format
const missingEncodedFormat: EncodedPlaybackResource = { kind: "encoded", encoded: "QAAAjQIA" };
const mixed: EncodedPlaybackResource = {
  kind: "encoded",
  format: "test.encoded",
  encoded: "x",
  // @ts-expect-error a playback resource carries exactly one payload discriminant
  url: "https://a.example",
  dispose() {},
};
// @ts-expect-error streams are one-shot and do not advertise seeking
const seekableStream: StreamPlaybackResource = { kind: "stream", stream: audio, seekable: true };
const reader: ReaderPlaybackResource = { kind: "reader", size: 1000, container: "webm", read: () => audio };
const timed: TimedPlaybackResource = { kind: "timed", container: "mp4", open: () => audio };
const seekableRequests: readonly PlaybackRequest[] = [
  { itemId: "reader", resource: reader },
  { itemId: "timed", resource: timed },
];
// @ts-expect-error reader containers are limited to webm and mp4
const oggReader: ReaderPlaybackResource = { kind: "reader", size: 1, container: "ogg", read: () => audio };
// @ts-expect-error a reader needs its byte size
const sizelessReader: ReaderPlaybackResource = { kind: "reader", container: "webm", read: () => audio };
// @ts-expect-error a timed resource opens at a time and has no byte reader
const readingTimed: TimedPlaybackResource = { kind: "timed", container: "webm", open: () => audio, read: () => audio };
// @ts-expect-error Song cannot carry a playback resource
new Song({ id: "leak", name: "Leak", url: "https://provider.example/leak", duration: 1, source: "source", resource });
// @ts-expect-error QueueItem cannot carry a playback resource
queue.add(song, { resource });

interface Requester {
  readonly requestedBy: string;
}
declare const typed: DisTube<Requester>;
declare const untyped: DisTube;

// Exact equality: assignability alone would also accept `any` or a metadata type without `| undefined`.
expectTypeOf<NonNullable<Awaited<ReturnType<DisTube<Requester>["play"]>>["current"]>["metadata"]>().toEqualTypeOf<
  Requester | undefined
>();
// The declared shape reaches every hand-back without a cast, assertion, or narrowing.
const typedFromPlay: Promise<Requester> = typed
  .play({ guildId: "guild", id: "voice" }, "query", { metadata: { requestedBy: "skick" }, next: true })
  .then(result => (result.current ?? result.upcoming[0])?.metadata ?? { requestedBy: "" });
const typedFromQueue: string | undefined = typed.getQueue("guild")?.current?.metadata?.requestedBy;
const typedFromHistory: string | undefined = typed.getQueue("guild")?.history[0]?.metadata?.requestedBy;
typed.on("queue.item.added", event => event.item.metadata?.requestedBy);
typed.on("queue.history.added", event => {
  const captured: QueueState<Requester> = event.state;
  return captured.history[0]?.metadata?.requestedBy;
});
typed.on("voice.track.finished", event => event.itemId);

// @ts-expect-error metadata of the wrong shape fails before it can run
typed.play({ guildId: "guild", id: "voice" }, "query", { metadata: { requester: "skick" } });
// @ts-expect-error the same contract applies to add
typed.getQueue("guild")?.add("query", { metadata: {} });
// @ts-expect-error an omitted type parameter leaves metadata unknown, so a property read needs narrowing
untyped.getQueue("guild")?.current?.metadata?.requestedBy;
// Any value is still accepted when the parameter is omitted.
untyped.play({ guildId: "guild", id: "voice" }, "query", { metadata: Symbol("anything") });

void [typedFromPlay, typedFromQueue, typedFromHistory];

void [
  request,
  encodedRequest,
  options,
  context,
  fallback,
  source,
  legacySource,
  legacySession,
  legacyEngine,
  withoutDisposer,
  malformedResource,
  missingEncodedFormat,
  mixed,
  seekableStream,
  seekableRequests,
  oggReader,
  sizelessReader,
  readingTimed,
  idleTerminal,
  session,
  engine,
  returnedQueue,
  voiceFilters,
  voiceState,
  publicVoices,
  managedVoice,
  joined,
  played,
  file,
  stream,
  attachedVoice,
  capabilities,
  seekable,
  definitions,
  legacyDefinitions,
  entries,
  rawEntry,
];

// @ts-expect-error caller metadata binding is readonly
item.metadata = {};
// @ts-expect-error native voice channels identify their channel with id
untyped.play({ guildId: "guild", voiceChannelId: "voice" }, "query");
// @ts-expect-error playback URLs belong to integration resources, not Songs
song.resource;
// @ts-expect-error provider-specific metadata lives in pluginData, not a metadata slot
song.metadata;
// @ts-expect-error the waiting list is exposed as upcoming, not a mutable internal list
queue.items;
