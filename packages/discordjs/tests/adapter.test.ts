import type { Client, VoiceBasedChannel } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY, gatewayAdapter, native, resetNative } from "../../voice-core/tests/support/native";
import { DiscordJSAdapter } from "../src";

vi.mock("@discordjs/voice", async () => (await import("../../voice-core/tests/support/native")).voiceModule());

const GUILD = "guild";
const CHANNEL = "channel";
const TARGET = { guildId: GUILD, channelId: CHANNEL };
const JOIN = { selfDeaf: true, selfMute: false, timeoutMs: 50 };

function voiceChannel(id: string, bitrate = 64_000): unknown {
  return { id, guildId: GUILD, guild: { id: GUILD }, isVoiceBased: () => true, bitrate };
}

function fixture(channels: readonly unknown[] = [voiceChannel(CHANNEL)], user: unknown = { id: "bot" }) {
  const gateway = gatewayAdapter();
  const client = {
    user,
    guilds: {
      cache: new Map([
        [
          GUILD,
          {
            voiceAdapterCreator: gateway.creator,
            channels: { cache: new Map(channels.map(channel => [(channel as { id: string }).id, channel])) },
          },
        ],
      ]),
    },
  } as unknown as Client;
  return { gateway, adapter: new DiscordJSAdapter(client) };
}

beforeEach(resetNative);

describe("DiscordJSAdapter", () => {
  it("normalizes a native channel synchronously and refuses conflicting guild identity", () => {
    const { adapter, gateway } = fixture();
    expect(adapter.normalizeTarget({ id: CHANNEL, guildId: GUILD, guild: { id: GUILD } } as VoiceBasedChannel)).toEqual(
      TARGET,
    );
    expect(() =>
      adapter.normalizeTarget({ id: CHANNEL, guildId: GUILD, guild: { id: "other" } } as VoiceBasedChannel),
    ).toThrow("conflicting guild");
    expect(gateway.sendPayload).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "missing channel",
      channelId: "missing",
      channels: undefined,
      user: undefined,
      message: "Discord voice channel is unavailable",
    },
    {
      label: "nonvoice channel",
      channelId: CHANNEL,
      channels: [{ id: CHANNEL, guildId: GUILD, isVoiceBased: () => false }],
      user: undefined,
      message: "is not voice-capable",
    },
    {
      label: "foreign channel",
      channelId: CHANNEL,
      channels: [{ id: CHANNEL, guildId: "other", isVoiceBased: () => true }],
      user: undefined,
      message: "does not belong to guild",
    },
    {
      label: "missing client user",
      channelId: CHANNEL,
      channels: undefined,
      user: null,
      message: "Discord client user is unavailable",
    },
  ])("rejects a $label before gateway changes", async ({ channelId, channels, user, message }) => {
    const { adapter, gateway } = fixture(channels, user);

    await expect(adapter.createVoiceSession({ guildId: GUILD, channelId }, JOIN)).rejects.toThrow(message);
    expect(gateway.sendPayload).not.toHaveBeenCalled();
  });

  it("joins gateway only, sending and acknowledging the requested self flags", async () => {
    const { adapter, gateway } = fixture();
    const session = await adapter.createVoiceSession(TARGET, { ...JOIN, selfDeaf: false, selfMute: true });

    expect(gateway.sendPayload).toHaveBeenCalledWith({
      op: 4,
      d: { guild_id: GUILD, channel_id: CHANNEL, self_deaf: false, self_mute: true },
    });
    expect(session.gateway).toEqual(GATEWAY);
    expect(session.selfDeaf).toBe(false);
    expect(session.selfMute).toBe(true);
    expect(native.joinVoiceChannel).not.toHaveBeenCalled();
    await session.release();
  });

  it("reads the bitrate of the session's current channel, including after a move", async () => {
    const { adapter } = fixture([voiceChannel(CHANNEL, 64_000), voiceChannel("other", 128_000)]);
    const session = await adapter.createVoiceSession(TARGET, JOIN);
    const before = session.bitrate;

    await session.join("other");

    expect(before).toBe(64_000);
    expect(session.bitrate).toBe(128_000);
    await session.release();
  });

  it("passes engine settings to the engine it creates", () => {
    const { adapter } = fixture();
    const engine = adapter.createEngine({
      filters: { house: { render: () => "volume=2", label: "House" } },
      opusComplexity: 10,
      bufferMs: 500,
    });
    expect(engine.filters.get("house")?.label()).toBe("House");
  });
});
