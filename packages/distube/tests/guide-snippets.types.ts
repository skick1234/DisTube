// Maintained guide examples use only the published entry points. Build core before checking this file.

import type { Readable } from "node:stream";
import { DisTube, type DisTubeVoice, Song } from "distube";
import type {
  Adapter,
  Engine,
  JoinOptions,
  PlaybackContext,
  PlaybackPreparation,
  PlaybackResource,
  Player,
  SourcePlugin,
  VoiceSession,
  VoiceTarget,
} from "distube/integrations";

interface NativeChannel {
  readonly guildSnowflake: string;
  readonly voiceSnowflake: string;
}

interface RequestMetadata {
  readonly requestedBy: string;
}

interface ClipData {
  readonly plays: number;
}

class ClipSource implements SourcePlugin<ClipData> {
  readonly name = "clips";

  async resolve(url: string): Promise<Song<ClipData> | undefined> {
    if (url !== "https://example.audio/clip/1") return undefined;
    return new Song({ source: this.name, id: "1", name: "Clip", url, pluginData: { plays: 9 } });
  }

  async search(_query: string): Promise<readonly Song<ClipData>[]> {
    const song = await this.resolve("https://example.audio/clip/1");
    return song ? [song] : [];
  }

  async stream(song: Song<ClipData>, context: PlaybackContext): Promise<PlaybackPreparation> {
    context.signal.throwIfAborted();
    return { kind: "resource", resource: { kind: "encoded", format: "lavalink.v4", encoded: song.id, seekable: true } };
  }
}

declare const createGatewaySession: (target: VoiceTarget, options?: JoinOptions) => Promise<VoiceSession>;
declare const player: Player;

const adapter: Adapter<NativeChannel> = {
  normalizeTarget: channel => ({ guildId: channel.guildSnowflake, channelId: channel.voiceSnowflake }),
  createVoiceSession: createGatewaySession,
};

const remoteEngine: Engine = {
  accepts: new Set<PlaybackResource["kind"]>(["encoded", "url"]),
  encodedFormats: new Set(["lavalink.v4"]),
  capabilities: { seek: true },
  filters: new Map(),
  supportsResource: resource => resource.kind !== "url" || resource.headers === undefined,
  createPlayer: async () => player,
};

const clips = new ClipSource();
const distube = new DisTube<RequestMetadata, NativeChannel>({ adapter, sources: [clips], engine: remoteEngine });

async function musicCommand(channel: NativeChannel): Promise<void> {
  const queue = await distube.play(channel, "https://example.audio/clip/1", {
    metadata: { requestedBy: "user-id" },
  });
  const voice = queue.voice;
  await voice?.setVolume(80);
  await queue.add("https://example.audio/clip/1", { at: 0 });
  await queue.jump(1);
  await queue.previous();
  await queue.seek(5);
  const results = await distube.search("clip", { source: clips, limit: 5 });
  const plays: number | undefined = results[0]?.pluginData.plays;
  void plays;
}

async function directInputs(voice: DisTubeVoice<NativeChannel>, freshReadable: () => Readable): Promise<void> {
  await voice.play({ kind: "file", path: "/absolute/clip.mp3" });
  await voice.stop();
  await voice.play({
    kind: "url",
    url: "https://audio.example/private.mp3",
    headers: { Authorization: "Bearer token" },
    seekable: true,
  });
  if (voice.seekable) await voice.seek(12);
  await voice.stop();
  await voice.play({ kind: "stream", stream: freshReadable() });
}

void [musicCommand, directInputs];
