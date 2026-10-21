// Maintained guide examples use only the published entry points. Build core before checking this file.

import type { Readable } from "node:stream";
import { DisTube, type DisTubeVoice, Song } from "distube";
import type {
  Adapter,
  Engine,
  PlaybackPreparation,
  Player,
  Plugin,
  VoiceSession,
  VoiceSessionOptions,
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

class ClipSource implements Plugin<ClipData> {
  readonly name = "clips";

  async resolve(url: string): Promise<Song<ClipData> | undefined> {
    if (url !== "https://example.audio/clip/1") return undefined;
    return new Song({ source: this.name, id: "1", name: "Clip", url, pluginData: { plays: 9 } });
  }

  async search(_query: string): Promise<readonly Song<ClipData>[]> {
    const song = await this.resolve("https://example.audio/clip/1");
    return song ? [song] : [];
  }

  async stream(song: Song<ClipData>, options: { readonly signal: AbortSignal }): Promise<PlaybackPreparation> {
    options.signal.throwIfAborted();
    return { kind: "resource", resource: { kind: "url", url: song.url } };
  }
}

declare const createGatewaySession: (target: VoiceTarget, options: VoiceSessionOptions) => Promise<VoiceSession>;
declare const player: Player;

const localEngine: Engine = { filters: new Map(), createPlayer: async () => player };

const adapter: Adapter<NativeChannel> = {
  normalizeTarget: channel => ({ guildId: channel.guildSnowflake, channelId: channel.voiceSnowflake }),
  createVoiceSession: createGatewaySession,
  createEngine: () => localEngine,
};

const remote: Plugin = {
  name: "remote",
  engine: {
    filters: new Map(),
    createPlayer: async () => player,
    prepare: async (song, { stream }) => {
      const preparation = await stream?.();
      return preparation?.kind === "resource"
        ? preparation.resource
        : { kind: "encoded", format: "remote", encoded: song.id };
    },
  },
};

const clips = new ClipSource();
const distube = new DisTube<RequestMetadata, NativeChannel>({ adapter, plugins: [clips], engine: { bufferMs: 400 } });
const remoteDistube = new DisTube({ adapter, plugins: [clips, remote] });

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
  const end = await voice.play({ kind: "file", path: "/absolute/clip.mp3" }, { onStart: () => undefined });
  const reason: "finished" | "stopped" | "replaced" = end.reason;
  void reason;
  await voice.play({
    kind: "url",
    url: "https://audio.example/private.mp3",
    headers: { Authorization: "Bearer token" },
    seekable: true,
  });
  await voice.setBitrate("auto");
  await voice.play({ kind: "stream", stream: freshReadable() }, { signal: AbortSignal.timeout(30_000) });
}

void [musicCommand, directInputs, remoteDistube];
