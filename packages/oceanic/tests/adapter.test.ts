import { VoiceConnectionStatus } from "@discordjs/voice";
import { ErrorCode, Filters, type PlaybackRequest, type VoiceSession } from "distube";
import type { Client } from "oceanic.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OceanicAdapter } from "../src";
import { CHANNEL, connection, GATEWAY, native, resetNative, settle } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const GUILD = "guild";
const TARGET = { guildId: GUILD, channelId: CHANNEL };
const adapterCreator = () => ({});

/** A client that owns exactly one guild, which is all the adapter reads from it. */
function client(guilds: Iterable<[string, unknown]> = [[GUILD, { voiceAdapterCreator: adapterCreator }]]): Client {
  return { guilds: new Map(guilds) } as unknown as Client;
}

beforeEach(resetNative);

describe("adapter", () => {
  it("requires a client and a positive connection timeout", () => {
    expect(() => new OceanicAdapter(undefined as unknown as Client)).toThrow("requires an Oceanic Client");
    expect(() => new OceanicAdapter(client(), { connectionTimeoutMs: 0 })).toThrow("must be positive");
    expect(() => new OceanicAdapter(client(), { connectionTimeoutMs: 1.5 })).toThrow("must be positive");
  });

  it("refuses a guild that is missing or cannot bridge the gateway", async () => {
    await expect(new OceanicAdapter(client([])).createVoiceSession(TARGET)).rejects.toThrow(
      `Oceanic guild is unavailable: ${GUILD}`,
    );
    await expect(new OceanicAdapter(client([[GUILD, {}]])).createVoiceSession(TARGET)).rejects.toThrow(
      "does not expose a voice adapter creator",
    );
    expect(native.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("joins with the guild's adapter creator and publishes the settled gateway data", async () => {
    const adapter = new OceanicAdapter(client(), { connectionTimeoutMs: 200 });

    const session = await adapter.createVoiceSession(TARGET);

    expect(native.joinVoiceChannel).toHaveBeenCalledWith({
      guildId: GUILD,
      channelId: CHANNEL,
      adapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    expect(native.entersState).toHaveBeenCalledWith(connection(), VoiceConnectionStatus.Ready, 200);
    expect(session.guildId).toBe(GUILD);
    expect(session.gateway).toEqual(GATEWAY);
  });
});

describe("session lifetime", () => {
  it("moves one session between channels rather than rejoining voice", async () => {
    const adapter = new OceanicAdapter(client());
    const session = await adapter.createVoiceSession(TARGET);

    await session.join("other");

    expect(connection().rejoin).toHaveBeenCalledWith({ channelId: "other", selfDeaf: true, selfMute: false });
    expect(native.joinVoiceChannel).toHaveBeenCalledTimes(1);
    expect(session.channelId).toBe("other");
  });

  it("restores the committed channel when native rejoin is refused", async () => {
    const adapter = new OceanicAdapter(client());
    const session = await adapter.createVoiceSession(TARGET);
    connection().rejoin.mockImplementationOnce(config => {
      connection().joinConfig.channelId = config.channelId;
      return false;
    });

    await expect(session.join("other")).rejects.toThrow("Discord gateway is unavailable");

    expect(session.channelId).toBe(CHANNEL);
    expect(connection().joinConfig.channelId).toBe(CHANNEL);
  });

  it("restores the committed channel when readiness rejects after native rejoin", async () => {
    const adapter = new OceanicAdapter(client());
    const session = await adapter.createVoiceSession(TARGET);
    native.entersState.mockRejectedValueOnce(new Error("ready timeout"));

    await expect(session.join("other")).rejects.toThrow("ready timeout");

    expect(session.channelId).toBe(CHANNEL);
    expect(connection().joinConfig.channelId).toBe(CHANNEL);
  });

  it("shares one completion between concurrent releases and goes quiet afterwards", async () => {
    const adapter = new OceanicAdapter(client());
    const session = await adapter.createVoiceSession(TARGET);
    const listener = vi.fn();
    session.subscribe(listener);

    await Promise.all([session.release(), session.release()]);

    expect(connection().destroy).toHaveBeenCalledTimes(1);
    // The listener came off with the connection, so its own destruction reaches nobody.
    connection().transition({ status: VoiceConnectionStatus.Destroyed });
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("engine", () => {
  it("plays through its own session only, and retires that player when the session ends", async () => {
    const adapter = new OceanicAdapter(client());
    const session = await adapter.createVoiceSession(TARGET);

    const player = await adapter.engine.createPlayer(session);
    expect(connection().subscribe).toHaveBeenCalled();
    // Nothing is playing, so ending a track is a no-op rather than an error.
    await expect(player.stopTrack()).resolves.toBeUndefined();

    await session.release();
    await expect(player.play(urlRequest())).rejects.toThrow("retired");

    await expect(adapter.engine.createPlayer({ guildId: GUILD } as unknown as VoiceSession)).rejects.toThrow(
      "only plays through its own package's VoiceSession",
    );
  });

  it("declines the resources and controls ffmpeg decoding cannot offer", async () => {
    const adapter = new OceanicAdapter(client());
    const player = await adapter.engine.createPlayer(await adapter.createVoiceSession(TARGET));

    const encoded = { itemId: "item", resource: { kind: "encoded", data: "track", dispose: vi.fn() } };
    await expect(player.play(encoded as unknown as PlaybackRequest)).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED,
    });
    await expect(player.seek(10)).rejects.toMatchObject({ code: ErrorCode.UNSUPPORTED });
  });

  it("resolves its built-in filters alongside the presets it was configured with", () => {
    const adapter = new OceanicAdapter(client(), { filters: { house: "volume=2" } });

    expect(adapter.engine.resolvable(Filters.Nightcore)).toBe(true);
    expect(adapter.engine.resolvable("house")).toBe(true);
    expect(adapter.engine.resolvable("unknown")).toBe(false);
  });
});

function urlRequest(): PlaybackRequest {
  return { itemId: "item", resource: { kind: "url", url: "https://stream.example/audio", dispose: vi.fn() } };
}
