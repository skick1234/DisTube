import { ChannelType, type Client, PermissionFlagsBits, PermissionsBitField, type VoiceBasedChannel } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gatewayAdapter, resetNative } from "../../voice-core/tests/support/native";
import { DiscordJSAdapter } from "../src";

vi.mock("@discordjs/voice", async () => (await import("../../voice-core/tests/support/native")).voiceModule());

const GUILD = "guild";
const CHANNEL = "channel";
const TARGET = { guildId: GUILD, channelId: CHANNEL };
const JOIN = { selfDeaf: true, selfMute: false, timeoutMs: 50 };

const { Connect, Speak, MoveMembers } = PermissionFlagsBits;

function voiceChannel(
  id: string,
  { bitrate = 64_000, allowed = [Connect, Speak], full = false, type = ChannelType.GuildVoice } = {},
): unknown {
  const permissions = new PermissionsBitField(allowed);
  return {
    id,
    guildId: GUILD,
    guild: { id: GUILD },
    type,
    isVoiceBased: () => true,
    bitrate,
    full,
    permissionsFor: (member: string) => (member === "bot" ? permissions : null),
  };
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
            id: GUILD,
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

  it("reads the bitrate of the session's current channel, including after a move", async () => {
    const { adapter } = fixture([
      voiceChannel(CHANNEL, { bitrate: 64_000 }),
      voiceChannel("other", { bitrate: 128_000 }),
    ]);
    const session = await adapter.createVoiceSession(TARGET, JOIN);
    const before = session.bitrate;

    await session.join("other");

    expect(before).toBe(64_000);
    expect(session.bitrate).toBe(128_000);
    await session.release();
  });

  describe("with a 15 s join deadline that never elapses", () => {
    const DEADLINE = { ...JOIN, timeoutMs: 15_000 };
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it.each([
      { label: "denies the bot Connect", channel: voiceChannel(CHANNEL, { allowed: [Speak] }) },
      { label: "denies the bot Speak", channel: voiceChannel(CHANNEL, { allowed: [Connect] }) },
      { label: "is full and the bot lacks Move Members", channel: voiceChannel(CHANNEL, { full: true }) },
    ])("rejects a join to a channel that $label before any gateway payload", async ({ label, channel }) => {
      const { adapter, gateway } = fixture([channel]);

      await expect(adapter.createVoiceSession(TARGET, DEADLINE)).rejects.toThrow(label);
      expect(gateway.sendPayload).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: "a stage channel that denies the bot Speak",
        channel: voiceChannel(CHANNEL, { allowed: [Connect], type: ChannelType.GuildStageVoice }),
      },
      {
        label: "a full channel with Move Members",
        channel: voiceChannel(CHANNEL, { full: true, allowed: [Connect, Speak, MoveMembers] }),
      },
    ])("joins $label", async ({ channel }) => {
      const { adapter, gateway } = fixture([channel]);
      const session = await adapter.createVoiceSession(TARGET, DEADLINE);

      expect(gateway.sendPayload).toHaveBeenCalledWith({
        op: 4,
        d: { guild_id: GUILD, channel_id: CHANNEL, self_deaf: true, self_mute: false },
      });
      await session.release();
    });
  });

  it("passes engine settings to the engine it creates", () => {
    const { adapter } = fixture();
    const engine = adapter.createEngine({
      filters: { house: { render: () => "volume=2", label: "House" } },
      opusComplexity: 10,
      bufferMs: 500,
    });
    expect(engine.filters.get("house")?.label).toBe("House");
  });
});
