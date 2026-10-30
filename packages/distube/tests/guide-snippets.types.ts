// Maintained guide examples use only the published entry points. Build core before checking this file.

import type { Readable } from "node:stream";
import { DisTube, Song } from "distube";
import type {
  Adapter,
  Engine,
  PlaybackResource,
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

  async stream(song: Song<ClipData>, options: { readonly signal: AbortSignal }): Promise<PlaybackResource> {
    options.signal.throwIfAborted();
    return { kind: "url", url: song.url };
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
    prepare: async (song, { signal }) => {
      signal.throwIfAborted();
      return { kind: "encoded", format: "remote", encoded: song.id };
    },
  },
};

declare const freshReadable: () => Readable;

const sounds: Plugin = {
  name: "sounds",
  async stream(song) {
    return song.id === "live"
      ? { kind: "stream", stream: freshReadable() }
      : { kind: "file", path: `/sounds/${song.id}.mp3` };
  },
};

const clips = new ClipSource();
const distube = new DisTube<RequestMetadata, NativeChannel>({
  adapter,
  plugins: [clips, sounds],
  maxPlaylistSongs: 1000,
  engine: { bufferMs: 400 },
});
const remoteDistube = new DisTube({ adapter, plugins: [clips, remote] });

async function musicCommand(channel: NativeChannel): Promise<void> {
  const { queue } = await distube.play(channel, "https://example.audio/clip/1", {
    metadata: { requestedBy: "user-id" },
  });
  const voice = queue.voice;
  await voice?.setVolume(80);
  await queue.add("https://example.audio/clip/1", { at: 0, metadata: { requestedBy: "user-id" } });
  const found: typeof queue | undefined = distube.getQueue("guild-id");
  void found;
  const stop = distube.on("queue.item.started", ({ item, fallback }) => void [item.metadata.requestedBy, fallback]);
  stop();
  await queue.jump(1);
  await queue.skip();
  await queue.previous();
  await queue.seek(5);
  await queue.pause();
  const paused: boolean = queue.paused;
  await queue.resume();
  queue.shuffle();
  const removed = queue.remove(1);
  void [paused, removed];
  const completions: readonly string[] = await distube.suggest("cli", { source: clips });
  void completions;
  const results = await distube.search("clip", { source: clips, limit: 5 });
  const plays: number | undefined = results[0]?.pluginData.plays;
  void plays;
}

async function soundCommand(channel: NativeChannel): Promise<void> {
  const airhorn = new Song({ source: "sounds", id: "airhorn", name: "Airhorn", url: "https://example.audio/airhorn" });
  const { queue } = await distube.play(channel, airhorn, { next: true, metadata: { requestedBy: "user-id" } });
  await queue.stop();
}

void [musicCommand, soundCommand, remoteDistube];
