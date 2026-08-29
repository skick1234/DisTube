import { VoiceConnectionStatus } from "@discordjs/voice";
import type { Client } from "discord.js";
import { DisTubeError, ErrorCode, Filters, type PlaybackRequest, type VoiceSession } from "distube";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordJSAdapter } from "../src";
import { CHANNEL, connection, GATEWAY, native, resetNative, settle } from "./support/native";

const { preflight, preflightFactory } = vi.hoisted(() => {
  const preflight = vi.fn(async (): Promise<void> => undefined);
  const preflightFactory = vi.fn((_owner: string) => preflight);
  return { preflight, preflightFactory };
});

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());
vi.mock("@distube/voice-core/discord", async importOriginal => {
  const actual = await importOriginal<typeof import("@distube/voice-core/discord")>();
  return { ...actual, discordPreflight: preflightFactory };
});

const GUILD = "guild";
const TARGET = { guildId: GUILD, channelId: CHANNEL };
const CLIENT_USER_ID = "bot";
const adapterCreator = () => ({});

/** A cached Discord channel in the small shape the Adapter needs to validate. */
function voiceChannel(guildId = GUILD): unknown {
  return { guildId, isVoiceBased: (): boolean => true };
}

function textChannel(guildId = GUILD): unknown {
  return { guildId, isVoiceBased: (): boolean => false };
}

function guild(channels: Iterable<[string, unknown]> = [[CHANNEL, voiceChannel()]]): unknown {
  return { voiceAdapterCreator: adapterCreator, channels: { cache: new Map(channels) } };
}

/** A client that owns exactly one cached guild, channel, and connected bot identity. */
function client(guilds: Iterable<[string, unknown]> = [[GUILD, guild()]]): Client {
  return { user: { id: CLIENT_USER_ID }, guilds: { cache: new Map(guilds) } } as unknown as Client;
}

beforeEach(() => {
  resetNative();
  preflight.mockReset();
  preflight.mockResolvedValue(undefined);
  preflightFactory.mockClear();
});

describe("adapter", () => {
  it("requires a client and a positive connection timeout", () => {
    expect(() => new DiscordJSAdapter(undefined as unknown as Client)).toThrow("requires a discord.js Client");
    expect(() => new DiscordJSAdapter(client(), { connectionTimeoutMs: 0 })).toThrow("must be positive");
    expect(() => new DiscordJSAdapter(client(), { connectionTimeoutMs: 1.5 })).toThrow("must be positive");
  });

  it("refuses a guild the client does not have before touching voice", async () => {
    const adapter = new DiscordJSAdapter(client([]));

    await expect(adapter.createVoiceSession(TARGET)).rejects.toThrow(`Discord guild is unavailable: ${GUILD}`);
    expect(native.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("validates missing, text, and cross-guild channels before touching voice", async () => {
    const cases: readonly [Iterable<[string, unknown]>, string][] = [
      [[], `Discord voice channel is unavailable: ${CHANNEL}`],
      [[[CHANNEL, textChannel()]], `Discord channel is not voice-capable: ${CHANNEL}`],
      [[[CHANNEL, voiceChannel("other-guild")]], `does not belong to guild ${GUILD}`],
    ];

    for (const [channels, message] of cases) {
      const adapter = new DiscordJSAdapter(client([[GUILD, guild(channels)]]));
      await expect(adapter.createVoiceSession(TARGET)).rejects.toThrow(message);
    }

    expect(native.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("runs prerequisite preflight before creating a native voice connection", async () => {
    const failure = new DisTubeError(ErrorCode.VOICE_FAILED, "@distube/discordjs requires sodium");
    preflight.mockRejectedValueOnce(failure);
    const adapter = new DiscordJSAdapter(client());

    await expect(adapter.createVoiceSession(TARGET)).rejects.toBe(failure);
    expect(native.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("joins with the guild's adapter creator and publishes the settled gateway data", async () => {
    const adapter = new DiscordJSAdapter(client(), { connectionTimeoutMs: 200 });

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
    expect(session.clientUserId).toBe(CLIENT_USER_ID);
    expect(session.gateway).toEqual(GATEWAY);
  });
});

describe("session lifetime", () => {
  it("moves one session between channels rather than rejoining voice", async () => {
    const adapter = new DiscordJSAdapter(client());
    const session = await adapter.createVoiceSession(TARGET);

    await session.join("other");

    expect(connection().rejoin).toHaveBeenCalledWith({ channelId: "other", selfDeaf: true, selfMute: false });
    expect(native.joinVoiceChannel).toHaveBeenCalledTimes(1);
    expect(session.channelId).toBe("other");
  });

  it("restores the committed channel when native rejoin is refused", async () => {
    const adapter = new DiscordJSAdapter(client());
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
    const adapter = new DiscordJSAdapter(client());
    const session = await adapter.createVoiceSession(TARGET);
    native.entersState.mockRejectedValueOnce(new Error("ready timeout"));

    await expect(session.join("other")).rejects.toThrow("ready timeout");

    expect(session.channelId).toBe(CHANNEL);
    expect(connection().joinConfig.channelId).toBe(CHANNEL);
  });

  it("shares one completion between concurrent releases and goes quiet afterwards", async () => {
    const adapter = new DiscordJSAdapter(client());
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
    const adapter = new DiscordJSAdapter(client());
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
    const adapter = new DiscordJSAdapter(client());
    const player = await adapter.engine.createPlayer(await adapter.createVoiceSession(TARGET));

    const encoded = { itemId: "item", resource: { kind: "encoded", data: "track", dispose: vi.fn() } };
    await expect(player.play(encoded as unknown as PlaybackRequest)).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED,
    });
    await expect(player.seek(10)).rejects.toMatchObject({ code: ErrorCode.UNSUPPORTED });
  });

  it("resolves its built-in filters alongside the presets it was configured with", () => {
    const adapter = new DiscordJSAdapter(client(), { filters: { house: "volume=2" } });

    expect(adapter.engine.resolvable(Filters.Nightcore)).toBe(true);
    expect(adapter.engine.resolvable("house")).toBe(true);
    expect(adapter.engine.resolvable("unknown")).toBe(false);
  });
});

function urlRequest(): PlaybackRequest {
  return { itemId: "item", resource: { kind: "url", url: "https://stream.example/audio", dispose: vi.fn() } };
}
