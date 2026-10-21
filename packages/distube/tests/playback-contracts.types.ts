import { expectTypeOf } from "vitest";
import type { DisTube, DisTubeQueue, DisTubeVoice, QueueItem, QueueState, TrackEnd, VoiceManager } from "../src";
import { Song } from "../src";
import type {
  Adapter,
  EncodedPlaybackResource,
  Engine,
  EngineSettings,
  FilterDefinitionInfo,
  FilterDefinitions,
  FilterEntry,
  JoinOptions,
  PlaybackPreparation,
  Player,
  Plugin,
  PrepareContext,
  ReaderPlaybackResource,
  SearchOptions,
  StreamPlaybackResource,
  TimedPlaybackResource,
  TrackOptions,
  UrlPlaybackResource,
  VoiceSession,
  VoiceSessionEvent,
  VoiceSessionOptions,
} from "../src/integrations";

const resource: UrlPlaybackResource = { kind: "url", url: "https://stream.example/audio", dispose: () => undefined };
const encoded: EncodedPlaybackResource = { kind: "encoded", format: "lavalink.v4", encoded: "QAAAjQIA" };
declare const audio: StreamPlaybackResource["stream"];
const direct: PlaybackPreparation = { kind: "resource", resource };
const fallback: PlaybackPreparation = { kind: "search", query: "title artist" };
const song = new Song({ id: "song", name: "Song", url: "https://provider.example/song", source: "source" });

const source: Plugin = {
  name: "source",
  dispose(): void {},
  async search(_query: string, options: SearchOptions): Promise<readonly Song[]> {
    const page: [number, number] = [options.limit, options.offset];
    void page;
    return [song];
  },
  async resolve(): Promise<Song> {
    return song;
  },
  async stream(): Promise<PlaybackPreparation> {
    return direct;
  },
};
// @ts-expect-error plugins lost initialize
const initializing: Plugin = { name: "old", initialize(): void {} };

const player: Player = {
  position: 0,
  async play(_resource, options: TrackOptions): Promise<TrackEnd> {
    options.onStart();
    return options.signal.aborted ? { reason: "stopped" } : { reason: "finished" };
  },
  async pause(): Promise<void> {},
  async resume(): Promise<void> {},
  async stopTrack(): Promise<void> {},
  async seek(): Promise<void> {},
  async setVolume(): Promise<void> {},
  async setFilters(_entries: readonly FilterEntry[]): Promise<void> {},
  async setBitrate(_bitrate: number | undefined): Promise<void> {},
  async release(): Promise<void> {},
};
// @ts-expect-error a track ends finished, stopped or replaced; failures reject
const failedEnd: TrackEnd = { reason: "failed" };
// @ts-expect-error Players lost the item-ID request and event channel
player.play({ itemId: "item", resource }, { signal: new AbortController().signal, onStart() {} });

const session: VoiceSession = {
  guildId: "guild",
  clientUserId: "bot",
  channelId: "voice",
  bitrate: 64_000,
  selfDeaf: true,
  selfMute: false,
  async join(_channelId: string, _options?: JoinOptions): Promise<void> {},
  async release(): Promise<void> {},
  subscribe(_listener: (event: VoiceSessionEvent) => void): () => void {
    return () => undefined;
  },
};
// @ts-expect-error a VoiceSession reports its channel bitrate
const bitrateless: VoiceSession = { ...session, bitrate: undefined };

const info: FilterDefinitionInfo = { default: 10, min: 0, max: 20, acceptsValue: true, label: () => "Bass" };
const engine: Engine = {
  filters: new Map([["bassboost", info]]),
  async createPlayer(_session: VoiceSession): Promise<Player> {
    return player;
  },
  async prepare(_song: Song, context: PrepareContext) {
    const preparation = await context.stream?.();
    return preparation?.kind === "resource" ? preparation.resource : encoded;
  },
};
const legacyEngine: Engine = {
  filters: new Map(),
  async createPlayer(): Promise<Player> {
    return player;
  },
  // @ts-expect-error engines no longer declare accepted kinds
  accepts: new Set(["url"]),
};
const adapter: Adapter = {
  normalizeTarget: target => ({
    guildId: "guildId" in target ? target.guildId : target.guild.id,
    channelId: target.id,
  }),
  async createVoiceSession(_target, options: VoiceSessionOptions): Promise<VoiceSession> {
    const timeout: number = options.timeoutMs;
    void timeout;
    return session;
  },
  createEngine(settings: EngineSettings): Engine {
    const tuning: [number, number] = [settings.opusComplexity, settings.bufferMs];
    void tuning;
    return engine;
  },
};
const enginePlugin: Plugin = { name: "remote", engine };

declare const queue: DisTubeQueue;
declare const voices: VoiceManager;
declare const voice: DisTubeVoice;
const played: Promise<TrackEnd> = voice.play(resource, { signal: new AbortController().signal, onStart() {} });
const bitrate: Promise<void> = voice.setBitrate("auto");
const bitrateSetting: number | "auto" = voice.bitrate;
const voiceState: [number, boolean, boolean] = [voice.volume, voice.selfDeaf, voice.selfMute];
const joined: Promise<DisTubeVoice> = voices.join({ guildId: "guild", id: "voice" }, { selfDeaf: false });
const removed: Promise<readonly QueueItem[]> = queue.remove(1);
const attachedVoice: DisTubeVoice | undefined = queue.voice;

// @ts-expect-error direct play lost caller item IDs
voice.play(resource, { itemId: "clip" });
// @ts-expect-error volume lives on the guild's DisTubeVoice
queue.setVolume(50);
// @ts-expect-error the schedule is read through current, upcoming and history
queue.state;
// @ts-expect-error DisTubeVoice release is internal
voice.release();

const definitions: FilterDefinitions<string> = {
  bassboost: { render: (value = 10) => `bass=g=${value}`, default: 10, min: 0, max: 20, label: v => `Bass +${v}dB` },
};
const reader: ReaderPlaybackResource = { kind: "reader", size: 1000, container: "webm", read: () => audio };
const timed: TimedPlaybackResource = { kind: "timed", container: "mp4", open: () => audio };
// @ts-expect-error reader containers are limited to webm and mp4
const oggReader: ReaderPlaybackResource = { kind: "reader", size: 1, container: "ogg", read: () => audio };
// @ts-expect-error Song cannot carry a playback resource
new Song({ id: "leak", name: "Leak", url: "https://provider.example/leak", source: "source", resource });

interface Requester {
  readonly requestedBy: string;
}
declare const typed: DisTube<Requester>;
declare const untyped: DisTube;

expectTypeOf<NonNullable<Awaited<ReturnType<DisTube<Requester>["play"]>>["current"]>["metadata"]>().toEqualTypeOf<
  Requester | undefined
>();
const typedFromQueue: string | undefined = typed.getQueue("guild")?.current?.metadata?.requestedBy;
typed.on("queue.history.added", event => {
  const captured: QueueState<Requester> = event.state;
  return captured.history[0]?.metadata?.requestedBy;
});
typed.on("queue.deleted", event => {
  const reason: "stop" | "finished" | "replaced" | "voice-loss" | "leave" | "shutdown" | "failed" = event.reason;
  return reason;
});
// @ts-expect-error voice track events were removed
typed.on("voice.track.finished", () => undefined);
// @ts-expect-error metadata of the wrong shape fails before it can run
typed.play({ guildId: "guild", id: "voice" }, "query", { metadata: { requester: "skick" } });
// @ts-expect-error an omitted type parameter leaves metadata unknown
untyped.getQueue("guild")?.current?.metadata?.requestedBy;

void [
  fallback,
  source,
  initializing,
  failedEnd,
  bitrateless,
  legacyEngine,
  adapter,
  enginePlugin,
  played,
  bitrate,
  bitrateSetting,
  voiceState,
  joined,
  removed,
  attachedVoice,
  definitions,
  reader,
  timed,
  oggReader,
  typedFromQueue,
];
