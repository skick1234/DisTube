import { AudioPlayerStatus, VoiceConnectionStatus } from "@discordjs/voice";
import type { Client } from "discord.js";
import type { PlaybackRequest, Player } from "distube";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordJSAdapter } from "../src";

const voice = vi.hoisted(() => {
  const handlers = new Map<string, (error?: Error) => void>();
  const audioPlayer = {
    on: vi.fn((event: string, listener: (error?: Error) => void) => handlers.set(event, listener)),
    play: vi.fn(),
    pause: vi.fn(() => true),
    unpause: vi.fn(() => true),
    stop: vi.fn(() => true),
    removeAllListeners: vi.fn(),
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
    guilds: { cache: new Map([[binding.guildId, { voiceAdapterCreator: vi.fn() }]]) },
  } as unknown as Client;
}

function request(): PlaybackRequest {
  return {
    itemId: "item",
    resource: { kind: "url", url: "https://stream.example/audio", dispose: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  voice.handlers.clear();
  voice.connection.state.status = VoiceConnectionStatus.Ready;
  voice.entersState.mockImplementation(async (target: unknown) => target);
});

describe("DiscordJSAdapter", () => {
  it("passes only platform-neutral binding data to a Player factory", async () => {
    const factory = vi.fn(async () => injectedPlayer);
    const adapter = new DiscordJSAdapter({} as Client, { playerFactory: factory });
    await expect(adapter.createPlayer(binding)).resolves.toBe(injectedPlayer);
    expect(factory).toHaveBeenCalledWith(binding);
  });

  it("validates construction options", () => {
    expect(() => new DiscordJSAdapter(undefined as unknown as Client)).toThrow(TypeError);
    expect(() => new DiscordJSAdapter({} as Client, { connectionTimeoutMs: 0 })).toThrow(TypeError);
  });

  it("creates a ready platform connection with neutral IDs", async () => {
    const adapter = new DiscordJSAdapter(client(), { connectionTimeoutMs: 50 });
    await expect(adapter.createPlayer(binding)).resolves.toMatchObject({ play: expect.any(Function) });
    expect(voice.joinVoiceChannel).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "guild", channelId: "channel", selfDeaf: true, selfMute: false }),
    );
    expect(voice.entersState).toHaveBeenCalledWith(voice.connection, VoiceConnectionStatus.Ready, 50);
  });

  it("plays an item and publishes its finished outcome", async () => {
    const player = await new DiscordJSAdapter(client()).createPlayer(binding);
    const listener = vi.fn();
    player.subscribe(listener);
    await player.play(request());
    expect(voice.createAudioResource).toHaveBeenCalledWith("https://stream.example/audio");
    expect(voice.audioPlayer.play).toHaveBeenCalledOnce();
    voice.handlers.get(AudioPlayerStatus.Idle)?.();
    expect(listener).toHaveBeenCalledWith({ type: "finished", itemId: "item" });
  });

  it("publishes playback failures and destroys failed connections", async () => {
    const adapter = new DiscordJSAdapter(client());
    const player = await adapter.createPlayer(binding);
    const listener = vi.fn();
    player.subscribe(listener);
    await player.play(request());
    const playbackError = new Error("decoder failed");
    voice.handlers.get("error")?.(playbackError);
    expect(listener).toHaveBeenCalledWith({ type: "failed", itemId: "item", error: playbackError });

    voice.entersState.mockRejectedValueOnce(new Error("connection timeout"));
    await expect(adapter.createPlayer(binding)).rejects.toThrow("connection timeout");
    expect(voice.connection.destroy).toHaveBeenCalledOnce();
  });

  it("validates prepared resources and retires terminally without disposing the source resource", async () => {
    const player = await new DiscordJSAdapter(client()).createPlayer(binding);
    await expect(
      player.play({ itemId: "item", resource: { kind: "url", url: "file:///audio", dispose: vi.fn() } }),
    ).rejects.toThrow("absolute HTTP(S)");
    const prepared = request();
    const listener = vi.fn();
    player.subscribe(listener);
    await player.play(prepared);
    const first = player.stop();
    const second = player.stop();
    await Promise.all([first, second]);
    voice.handlers.get(AudioPlayerStatus.Idle)?.();
    expect(listener).not.toHaveBeenCalled();
    expect(prepared.resource.dispose).not.toHaveBeenCalled();
    expect(voice.connection.destroy).toHaveBeenCalledTimes(1);
    await expect(player.play(request())).rejects.toThrow("stopped");
  });
});
