import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTubeError } from "distube";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY, gatewayAdapter, native, resetNative } from "../../voice-core/tests/support/native";
import { DiscordJSAdapter, type DiscordJSAdapterOptions } from "../src";

const { preflight, preflightFactory } = vi.hoisted(() => {
  const preflight = vi.fn(async (): Promise<void> => undefined);
  return { preflight, preflightFactory: vi.fn((_owner: string) => preflight) };
});

vi.mock("@discordjs/voice", async () => (await import("../../voice-core/tests/support/native")).voiceModule());
vi.mock("@distube/voice-core/discord", async importOriginal => {
  const actual = await importOriginal<typeof import("@distube/voice-core/discord")>();
  return { ...actual, discordPreflight: preflightFactory };
});

const GUILD = "guild";
const CHANNEL = "channel";
const TARGET = { guildId: GUILD, channelId: CHANNEL };

function fixture(
  channel: unknown = { id: CHANNEL, guildId: GUILD, guild: { id: GUILD }, isVoiceBased: () => true },
  user: unknown = { id: "bot" },
  options?: DiscordJSAdapterOptions,
) {
  const gateway = gatewayAdapter();
  const client = {
    user,
    guilds: {
      cache: new Map([
        [
          GUILD,
          {
            voiceAdapterCreator: gateway.creator,
            channels: { cache: new Map([[CHANNEL, channel]]) },
          },
        ],
      ]),
    },
  } as unknown as Client;
  return { gateway, adapter: new DiscordJSAdapter(client, options) };
}

beforeEach(() => {
  resetNative();
  preflight.mockReset();
  preflight.mockResolvedValue(undefined);
});

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

  it.each([0, 1.5])("refuses connectionTimeoutMs %s at construction", connectionTimeoutMs => {
    expect(() => fixture(undefined, undefined, { connectionTimeoutMs })).toThrow(
      "connectionTimeoutMs must be positive",
    );
  });

  it.each([
    {
      label: "missing channel",
      channelId: "missing",
      channel: undefined,
      user: undefined,
      message: "Discord voice channel is unavailable",
    },
    {
      label: "nonvoice channel",
      channelId: CHANNEL,
      channel: { id: CHANNEL, guildId: GUILD, isVoiceBased: () => false },
      user: undefined,
      message: "is not voice-capable",
    },
    {
      label: "foreign channel",
      channelId: CHANNEL,
      channel: { id: CHANNEL, guildId: "other", isVoiceBased: () => true },
      user: undefined,
      message: "does not belong to guild",
    },
    {
      label: "missing client user",
      channelId: CHANNEL,
      channel: undefined,
      user: null,
      message: "Discord client user is unavailable",
    },
  ])("rejects a $label before gateway changes", async ({ channelId, channel, user, message }) => {
    const { adapter, gateway } = fixture(channel, user);

    await expect(adapter.createVoiceSession({ guildId: GUILD, channelId })).rejects.toThrow(message);
    expect(gateway.sendPayload).not.toHaveBeenCalled();
  });

  it("joins gateway only, with complete credentials and acknowledged self flags", async () => {
    const { adapter, gateway } = fixture();
    const session = await adapter.createVoiceSession(TARGET, { selfDeaf: false, selfMute: true });

    expect(session.gateway).toEqual(GATEWAY);
    expect(session.selfDeaf).toBe(false);
    expect(session.selfMute).toBe(true);
    expect(native.joinVoiceChannel).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
    expect(preflightFactory).toHaveBeenCalledWith("@distube/discordjs");
    await session.setSelfMute(false);
    expect(gateway.sendPayload).toHaveBeenLastCalledWith({
      op: 4,
      d: { guild_id: GUILD, channel_id: CHANNEL, self_deaf: false, self_mute: false },
    });
    await session.release();
  });

  it("checks local prerequisites only when its selected engine creates audio", async () => {
    const { adapter } = fixture();
    const session = await adapter.createVoiceSession(TARGET);
    const failure = new DisTubeError("VOICE_FAILED", "@distube/discordjs requires sodium");
    preflight.mockRejectedValueOnce(failure);

    await expect(adapter.engine.createPlayer(session)).rejects.toBe(failure);
    expect(native.joinVoiceChannel).not.toHaveBeenCalled();
    const player = await adapter.engine.createPlayer(session);
    expect(native.joinVoiceChannel).toHaveBeenCalledTimes(1);
    await player.release();
    await session.release();
  });

  it("passes its configured filter presets to its engine", () => {
    const { adapter } = fixture(undefined, undefined, {
      filters: { house: { render: () => "volume=2", label: "House" } },
    });
    expect(adapter.engine.filters.get("house")?.label()).toBe("House");
  });
});
