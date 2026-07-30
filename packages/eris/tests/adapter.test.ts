import { EventEmitter } from "node:events";
import type { PlaybackRequest, Player, PlayerEvent, QueueBinding } from "distube";
import type { Client, VoiceConnection } from "eris";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErisAdapter } from "../src";

const binding: QueueBinding = { queueId: "queue", guildId: "guild", channelId: "channel" };

function request(id = "item"): PlaybackRequest {
  return {
    itemId: id,
    resource: { kind: "url", url: `https://stream.example/${id}`, dispose: vi.fn() },
  };
}

interface VoiceFixture {
  readonly client: Client;
  readonly connection: VoiceConnection;
  readonly emitter: EventEmitter;
  readonly getChannel: ReturnType<typeof vi.fn>;
  readonly joinVoiceChannel: ReturnType<typeof vi.fn>;
  readonly leaveVoiceChannel: ReturnType<typeof vi.fn>;
  readonly play: ReturnType<typeof vi.fn>;
  readonly pause: ReturnType<typeof vi.fn>;
  readonly resume: ReturnType<typeof vi.fn>;
  readonly stopPlaying: ReturnType<typeof vi.fn>;
  setPlaying(value: boolean): void;
}

function voiceFixture(guildId = binding.guildId): VoiceFixture {
  const emitter = new EventEmitter();
  let playing = false;
  const play = vi.fn(() => {
    playing = true;
  });
  const pause = vi.fn();
  const resume = vi.fn();
  const stopPlaying = vi.fn();
  const connection = emitter as unknown as VoiceConnection;
  Object.defineProperties(connection, {
    playing: { configurable: true, get: () => playing },
    play: { configurable: true, value: play },
    pause: { configurable: true, value: pause },
    resume: { configurable: true, value: resume },
    stopPlaying: { configurable: true, value: stopPlaying },
  });
  const getChannel = vi.fn(() => ({ id: binding.channelId, guild: { id: guildId }, join: vi.fn() }));
  const joinVoiceChannel = vi.fn(async () => connection);
  const leaveVoiceChannel = vi.fn();
  const client = { getChannel, joinVoiceChannel, leaveVoiceChannel } as unknown as Client;
  return {
    client,
    connection,
    emitter,
    getChannel,
    joinVoiceChannel,
    leaveVoiceChannel,
    play,
    pause,
    resume,
    stopPlaying,
    setPlaying: value => {
      playing = value;
    },
  };
}

const injectedPlayer: Player = {
  play: vi.fn(async () => undefined),
  pause: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  seek: vi.fn(async () => undefined),
  subscribe: vi.fn(() => () => undefined),
};

beforeEach(() => vi.clearAllMocks());

describe("ErisAdapter", () => {
  it("validates construction options", () => {
    expect(() => new ErisAdapter(undefined as unknown as Client)).toThrow(TypeError);
    expect(() => new ErisAdapter({} as Client, { connectionTimeoutMs: 0 })).toThrow(TypeError);
    expect(() => new ErisAdapter({} as Client, { selfDeaf: "yes" as unknown as boolean })).toThrow(TypeError);
  });

  it("passes only neutral binding data to an injected factory", async () => {
    const factory = vi.fn(async () => injectedPlayer);
    const adapter = new ErisAdapter({} as Client, { playerFactory: factory });
    await expect(adapter.createPlayer(binding)).resolves.toBe(injectedPlayer);
    expect(factory).toHaveBeenCalledWith(binding);
  });

  it("validates channel ownership before joining", async () => {
    const fixture = voiceFixture("another-guild");
    const adapter = new ErisAdapter(fixture.client);
    await expect(adapter.createPlayer(binding)).rejects.toThrow("does not belong to guild");
    expect(fixture.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("rejects missing or non-voice channels", async () => {
    const fixture = voiceFixture();
    fixture.getChannel.mockReturnValueOnce(undefined);
    await expect(new ErisAdapter(fixture.client).createPlayer(binding)).rejects.toThrow("unavailable");
    fixture.getChannel.mockReturnValueOnce({ id: binding.channelId, guild: { id: binding.guildId } });
    await expect(new ErisAdapter(fixture.client).createPlayer(binding)).rejects.toThrow("unavailable");
  });

  it("joins a valid channel with configured voice state", async () => {
    const fixture = voiceFixture();
    await expect(
      new ErisAdapter(fixture.client, { selfDeaf: false, selfMute: true }).createPlayer(binding),
    ).resolves.toMatchObject({ play: expect.any(Function) });
    expect(fixture.joinVoiceChannel).toHaveBeenCalledWith(binding.channelId, { selfDeaf: false, selfMute: true });
  });

  it("releases partial connections after join failure", async () => {
    const fixture = voiceFixture();
    fixture.joinVoiceChannel.mockRejectedValueOnce(new Error("join failed"));
    await expect(new ErisAdapter(fixture.client).createPlayer(binding)).rejects.toThrow("join failed");
    expect(fixture.leaveVoiceChannel).toHaveBeenCalledWith(binding.channelId);
  });

  it("bounds connection readiness and cleans up a timed-out join", async () => {
    const fixture = voiceFixture();
    fixture.joinVoiceChannel.mockReturnValueOnce(new Promise(() => undefined));
    await expect(new ErisAdapter(fixture.client, { connectionTimeoutMs: 5 }).createPlayer(binding)).rejects.toThrow(
      "connection timed out",
    );
    expect(fixture.leaveVoiceChannel).toHaveBeenCalledWith(binding.channelId);
  });
});

describe("ErisPlayer", () => {
  it("rejects malformed prepared resources before native playback", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client).createPlayer(binding);
    await expect(
      player.play({ itemId: "item", resource: { kind: "url", url: "file:///audio", dispose: vi.fn() } }),
    ).rejects.toThrow("absolute HTTP(S)");
    expect(fixture.play).not.toHaveBeenCalled();
  });

  it("acknowledges play only after native start", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client).createPlayer(binding);
    let resolved = false;
    const started = player.play(request()).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(fixture.play).toHaveBeenCalledWith("https://stream.example/item");
    fixture.emitter.emit("start");
    await started;
    expect(resolved).toBe(true);
  });

  it("rejects play errors before start", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client).createPlayer(binding);
    const started = player.play(request());
    fixture.emitter.emit("error", new Error("decoder failed"));
    await expect(started).rejects.toThrow("decoder failed");
  });

  it("rejects a missing native start acknowledgement within the configured bound", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client, { connectionTimeoutMs: 5 }).createPlayer(binding);
    await expect(player.play(request())).rejects.toThrow("playback start timed out");
    expect(fixture.stopPlaying).toHaveBeenCalledOnce();
    await player.stop();
  });

  it("publishes exactly one natural finish for the active item", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client).createPlayer(binding);
    const listener = vi.fn<(event: PlayerEvent) => void>();
    player.subscribe(listener);
    const started = player.play(request("a"));
    fixture.emitter.emit("start");
    await started;
    fixture.emitter.emit("end");
    fixture.emitter.emit("end");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "finished", itemId: "a" });
  });

  it("publishes one failure and ignores a later end", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client).createPlayer(binding);
    const listener = vi.fn<(event: PlayerEvent) => void>();
    player.subscribe(listener);
    const started = player.play(request("a"));
    fixture.emitter.emit("start");
    await started;
    const error = new Error("voice failed");
    fixture.emitter.emit("error", error);
    fixture.emitter.emit("end");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "failed", itemId: "a", error });
  });

  it("maps unexpected disconnect and isolates subscribers", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client).createPlayer(binding);
    const second = vi.fn<(event: PlayerEvent) => void>();
    player.subscribe(() => {
      throw new Error("listener failed");
    });
    player.subscribe(second);
    const started = player.play(request("a"));
    fixture.emitter.emit("start");
    await started;
    fixture.emitter.emit("disconnect", new Error("network lost"));
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ type: "failed", itemId: "a" }));
  });

  it("pauses, resumes, and rejects unsupported seek", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client).createPlayer(binding);
    const started = player.play(request());
    fixture.emitter.emit("start");
    await started;
    await player.pause();
    await player.resume();
    await expect(player.seek(10)).rejects.toThrow("not supported");
    expect(fixture.pause).toHaveBeenCalledOnce();
    expect(fixture.resume).toHaveBeenCalledOnce();
  });

  it("drains stop, removes listeners, releases voice once, and is idempotent", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client).createPlayer(binding);
    const listener = vi.fn<(event: PlayerEvent) => void>();
    player.subscribe(listener);
    const started = player.play(request());
    fixture.emitter.emit("start");
    await started;
    fixture.setPlaying(true);
    const stopped = player.stop();
    fixture.emitter.emit("end");
    await stopped;
    await player.stop();
    fixture.emitter.emit("end");
    expect(listener).not.toHaveBeenCalled();
    expect(fixture.stopPlaying).toHaveBeenCalledOnce();
    expect(fixture.leaveVoiceChannel).toHaveBeenCalledOnce();
    expect(fixture.emitter.listenerCount("end")).toBe(0);
    await expect(player.play(request())).rejects.toThrow("stopped");
  });

  it("unsubscribes public listeners", async () => {
    const fixture = voiceFixture();
    const player = await new ErisAdapter(fixture.client).createPlayer(binding);
    const listener = vi.fn<(event: PlayerEvent) => void>();
    const unsubscribe = player.subscribe(listener);
    unsubscribe();
    const started = player.play(request());
    fixture.emitter.emit("start");
    await started;
    fixture.emitter.emit("end");
    expect(listener).not.toHaveBeenCalled();
  });
});
