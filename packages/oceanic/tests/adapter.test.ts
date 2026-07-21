import { AudioPlayerStatus, VoiceConnectionStatus } from "@discordjs/voice";
import { type Player, QueueItem, Song } from "distube";
import type { Client } from "oceanic.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OceanicAdapter } from "../src";

const voice = vi.hoisted(() => {
  const handlers = new Map<string, (error?: Error) => void>();
  const audioPlayer = {
    on: vi.fn((event: string, listener: (error?: Error) => void) => handlers.set(event, listener)),
    play: vi.fn(),
    pause: vi.fn(() => true),
    unpause: vi.fn(() => true),
    stop: vi.fn(() => true),
  };
  const connection = {
    subscribe: vi.fn(),
    destroy: vi.fn(),
    state: { status: "ready" },
  };
  return {
    handlers,
    audioPlayer,
    connection,
    createAudioPlayer: vi.fn(() => audioPlayer),
    createAudioResource: vi.fn((url: string) => ({ url })),
    entersState: vi.fn(async (target: unknown) => target),
    joinVoiceChannel: vi.fn(() => connection),
  };
});

vi.mock("@discordjs/voice", async () => ({
  ...(await vi.importActual<typeof import("@discordjs/voice")>("@discordjs/voice")),
  createAudioPlayer: voice.createAudioPlayer,
  createAudioResource: voice.createAudioResource,
  entersState: voice.entersState,
  joinVoiceChannel: voice.joinVoiceChannel,
}));

const injectedPlayer: Player = {
  play: vi.fn(async () => undefined),
  pause: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  seek: vi.fn(async () => undefined),
  subscribe: vi.fn(() => () => undefined),
};

const binding = { queueId: "queue", guildId: "guild", channelId: "channel" };

function client(): Client {
  return {
    guilds: new Map([[binding.guildId, { voiceAdapterCreator: vi.fn() }]]),
  } as unknown as Client;
}

function item(): QueueItem {
  return new QueueItem({
    id: "item",
    song: new Song({ id: "song", title: "Song", url: "https://example.com/audio", duration: 1, source: "test" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  voice.handlers.clear();
  voice.connection.state.status = VoiceConnectionStatus.Ready;
  voice.entersState.mockImplementation(async (target: unknown) => target);
});

describe("OceanicAdapter", () => {
  it("passes only platform-neutral binding data to a Player factory", async () => {
    const factory = vi.fn(async () => injectedPlayer);
    const adapter = new OceanicAdapter({} as Client, { playerFactory: factory });
    await expect(adapter.createPlayer(binding)).resolves.toBe(injectedPlayer);
    expect(factory).toHaveBeenCalledWith(binding);
  });

  it("validates construction options", () => {
    expect(() => new OceanicAdapter(undefined as unknown as Client)).toThrow(TypeError);
    expect(() => new OceanicAdapter({} as Client, { connectionTimeoutMs: -1 })).toThrow(TypeError);
  });

  it("creates a ready platform connection with neutral IDs", async () => {
    const adapter = new OceanicAdapter(client(), { connectionTimeoutMs: 50 });
    await expect(adapter.createPlayer(binding)).resolves.toMatchObject({ play: expect.any(Function) });
    expect(voice.joinVoiceChannel).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild", channelId: "channel", selfDeaf: true, selfMute: false }),
    );
    expect(voice.entersState).toHaveBeenCalledWith(voice.connection, VoiceConnectionStatus.Ready, 50);
  });

  it("plays an item and publishes its finished outcome", async () => {
    const player = await new OceanicAdapter(client()).createPlayer(binding);
    const listener = vi.fn();
    player.subscribe(listener);
    await player.play(item());
    expect(voice.createAudioResource).toHaveBeenCalledWith("https://example.com/audio");
    expect(voice.audioPlayer.play).toHaveBeenCalledOnce();
    voice.handlers.get(AudioPlayerStatus.Idle)?.();
    expect(listener).toHaveBeenCalledWith({ type: "finished", itemId: "item" });
  });

  it("publishes playback failures and destroys failed connections", async () => {
    const adapter = new OceanicAdapter(client());
    const player = await adapter.createPlayer(binding);
    const listener = vi.fn();
    player.subscribe(listener);
    await player.play(item());
    const playbackError = new Error("decoder failed");
    voice.handlers.get("error")?.(playbackError);
    expect(listener).toHaveBeenCalledWith({ type: "failed", itemId: "item", error: playbackError });

    voice.entersState.mockRejectedValueOnce(new Error("connection timeout"));
    await expect(adapter.createPlayer(binding)).rejects.toThrow("connection timeout");
    expect(voice.connection.destroy).toHaveBeenCalledOnce();
  });
});
