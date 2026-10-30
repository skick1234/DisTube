import { ChannelTypes, type Client, Permission, type PermissionName, Permissions, type VoiceChannel } from "oceanic.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gatewayAdapter, resetNative } from "../../voice-core/tests/support/native";
import { OceanicAdapter } from "../src";

vi.mock("@discordjs/voice", async () => (await import("../../voice-core/tests/support/native")).voiceModule());

const GUILD = "guild";
const CHANNEL = "channel";
const TARGET = { guildId: GUILD, channelId: CHANNEL };
const JOIN = { selfDeaf: true, selfMute: false, timeoutMs: 50 };

function permission(...names: PermissionName[]): Permission {
  return new Permission(names.reduce((bits, name) => bits | Permissions[name], 0n));
}

function voiceChannel(
  id: string,
  {
    bitrate = 64_000,
    allowed = permission("CONNECT", "SPEAK"),
    userLimit = 0,
    members = 0,
    type = ChannelTypes.GUILD_VOICE,
  } = {},
): unknown {
  return {
    id,
    guildID: GUILD,
    guild: { id: GUILD },
    type,
    bitrate,
    userLimit,
    voiceMembers: { size: members },
    permissionsOf: (member: string) => {
      if (member !== "bot") throw new Error(`unexpected member ${member}`);
      return allowed;
    },
  };
}

function fixture(channels: readonly unknown[] = [voiceChannel(CHANNEL)], user: unknown = { id: "bot" }) {
  const gateway = gatewayAdapter();
  const client = {
    user,
    guilds: new Map([
      [
        GUILD,
        {
          id: GUILD,
          voiceAdapterCreator: gateway.creator,
          channels: new Map(channels.map(channel => [(channel as { id: string }).id, channel])),
        },
      ],
    ]),
  } as unknown as Client;
  return { gateway, adapter: new OceanicAdapter(client) };
}

beforeEach(resetNative);

describe("OceanicAdapter", () => {
  it("normalizes a native channel synchronously and refuses conflicting guild identity", () => {
    const { adapter, gateway } = fixture();
    expect(adapter.normalizeTarget({ id: CHANNEL, guildID: GUILD, guild: { id: GUILD } } as VoiceChannel)).toEqual(
      TARGET,
    );
    expect(() =>
      adapter.normalizeTarget({ id: CHANNEL, guildID: GUILD, guild: { id: "other" } } as VoiceChannel),
    ).toThrow("conflicting guild");
    expect(gateway.sendPayload).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "missing channel",
      channelId: "missing",
      channels: undefined,
      user: undefined,
      message: "Oceanic voice channel is unavailable",
    },
    {
      label: "text channel",
      channelId: CHANNEL,
      channels: [{ id: CHANNEL, guildID: GUILD, type: ChannelTypes.GUILD_TEXT }],
      user: undefined,
      message: "is not voice-capable",
    },
    {
      label: "foreign channel",
      channelId: CHANNEL,
      channels: [{ id: CHANNEL, guildID: "other", type: ChannelTypes.GUILD_VOICE }],
      user: undefined,
      message: "does not belong to guild",
    },
    {
      label: "missing client user",
      channelId: CHANNEL,
      channels: undefined,
      user: null,
      message: "Oceanic client user is unavailable",
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
      { label: "denies the bot Connect", channel: voiceChannel(CHANNEL, { allowed: permission("SPEAK") }) },
      { label: "denies the bot Speak", channel: voiceChannel(CHANNEL, { allowed: permission("CONNECT") }) },
      { label: "is full and the bot lacks Move Members", channel: voiceChannel(CHANNEL, { userLimit: 2, members: 2 }) },
    ])("rejects a join to a channel that $label before any gateway payload", async ({ label, channel }) => {
      const { adapter, gateway } = fixture([channel]);

      await expect(adapter.createVoiceSession(TARGET, DEADLINE)).rejects.toThrow(label);
      expect(gateway.sendPayload).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: "a stage channel that denies the bot Speak",
        channel: voiceChannel(CHANNEL, { allowed: permission("CONNECT"), type: ChannelTypes.GUILD_STAGE_VOICE }),
      },
      {
        label: "a full channel with Move Members",
        channel: voiceChannel(CHANNEL, {
          userLimit: 2,
          members: 2,
          allowed: permission("CONNECT", "SPEAK", "MOVE_MEMBERS"),
        }),
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
      report: () => undefined,
    });
    expect(engine.filters.get("house")?.label).toBe("House");
  });
});
