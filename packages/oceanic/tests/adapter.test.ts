import { AudioPlayerStatus, VoiceConnectionStatus } from "@discordjs/voice";
import type { PlaybackRequest } from "distube";
import type { Client } from "oceanic.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OceanicAdapter } from "../src";

const voice = vi.hoisted(() => {
  const handlers = new Map<string, (error?: Error) => void>();
  const connectionHandlers = new Map<string, (oldState: unknown, newState: unknown) => void>();
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
    on: vi.fn((event: string, listener: (oldState: unknown, newState: unknown) => void) =>
      connectionHandlers.set(event, listener),
    ),
    off: vi.fn((event: string) => connectionHandlers.delete(event)),
    state: { status: "ready" },
  };
  return {
    handlers,
    connectionHandlers,
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

const binding = { queueId: "queue", guildId: "guild", channelId: "channel" };

function client(): Client {
  return {
    guilds: new Map([[binding.guildId, { voiceAdapterCreator: vi.fn() }]]),
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
  voice.connectionHandlers.clear();
  voice.connection.state.status = VoiceConnectionStatus.Ready;
  voice.entersState.mockImplementation(async (target: unknown) => target);
  voice.audioPlayer.stop.mockImplementation(() => true);
  voice.audioPlayer.removeAllListeners.mockImplementation(() => undefined);
  voice.connection.destroy.mockImplementation(() => undefined);
  voice.connection.off.mockImplementation((event: string) => voice.connectionHandlers.delete(event));
});

describe("OceanicAdapter", () => {
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
    await player.play(request());
    expect(voice.createAudioResource).toHaveBeenCalledWith("https://stream.example/audio");
    expect(voice.audioPlayer.play).toHaveBeenCalledOnce();
    voice.handlers.get(AudioPlayerStatus.Idle)?.();
    expect(listener).toHaveBeenCalledWith({ type: "finished", itemId: "item" });
  });

  it("publishes playback failures and destroys failed connections", async () => {
    const adapter = new OceanicAdapter(client());
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

  it("terminalizes an unrecoverable native disconnect", async () => {
    const player = await new OceanicAdapter(client()).createPlayer(binding);
    const listener = vi.fn();
    player.subscribe(listener);
    await player.play(request());
    voice.connection.state.status = VoiceConnectionStatus.Destroyed;
    voice.connectionHandlers.get("stateChange")?.(
      { status: VoiceConnectionStatus.Ready },
      { status: VoiceConnectionStatus.Destroyed },
    );
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "failed", itemId: "item", terminal: true }));
    await expect(player.play(request())).rejects.toThrow("stopped");
  });

  it("validates prepared resources and retires terminally without disposing the source resource", async () => {
    const player = await new OceanicAdapter(client()).createPlayer(binding);
    await expect(
      player.play({ itemId: "item", resource: { kind: "url", url: "file:///audio", dispose: vi.fn() } }),
    ).rejects.toThrow("absolute HTTP(S)");
    const prepared = request();
    const listener = vi.fn();
    player.subscribe(listener);
    await player.play(prepared);
    const first = player.stop();
    const second = player.stop();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    voice.handlers.get(AudioPlayerStatus.Idle)?.();
    expect(listener).not.toHaveBeenCalled();
    expect(prepared.resource.dispose).not.toHaveBeenCalled();
    expect(voice.connection.destroy).toHaveBeenCalledTimes(1);
    await expect(player.play(request())).rejects.toThrow("stopped");
  });

  it("attempts every native cleanup unit and aggregates failures", async () => {
    const player = await new OceanicAdapter(client()).createPlayer(binding);
    voice.audioPlayer.stop.mockImplementation(() => {
      throw new Error("audio stop failed");
    });
    voice.connection.destroy.mockImplementation(() => {
      throw new Error("connection destroy failed");
    });
    let failure: unknown;
    try {
      await player.stop();
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((error: unknown) => (error as Error).message)).toEqual([
      "audio stop failed",
      "connection destroy failed",
    ]);
    expect(voice.audioPlayer.removeAllListeners).toHaveBeenCalledOnce();
  });
});
