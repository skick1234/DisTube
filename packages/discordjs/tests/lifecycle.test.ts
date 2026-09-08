import type { Client } from "discord.js";
import { DisTube, DisTubeError } from "distube";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AdapterLifecycleBridge, adapterLifecycleSuite } from "../../voice-core/tests/support/adapter-lifecycle";
import { latest, native, resetNative } from "../../voice-core/tests/support/native";
import { DiscordJSAdapter } from "../src";

const { preflight, preflightFactory } = vi.hoisted(() => {
  const preflight = vi.fn(async (): Promise<void> => undefined);
  const preflightFactory = vi.fn((_owner: string) => preflight);
  return { preflight, preflightFactory };
});

vi.mock("@discordjs/voice", async () => (await import("../../voice-core/tests/support/native")).voiceModule());
vi.mock("node:child_process", async () => (await import("../../voice-core/tests/support/native")).childProcessModule());
vi.mock("@distube/voice-core/discord", async importOriginal => {
  const actual = await importOriginal<typeof import("@distube/voice-core/discord")>();
  return { ...actual, discordPreflight: preflightFactory };
});

const GUILD = "guild";
const CHANNEL_A = "channel-a";
const CHANNEL_B = "channel-b";
const adapterCreator = () => ({});

function client(): Client {
  const voiceChannel = (id: string) => ({ guildId: GUILD, id, isVoiceBased: (): boolean => true });
  return {
    user: { id: "bot" },
    guilds: {
      cache: new Map([
        [
          GUILD,
          {
            voiceAdapterCreator: adapterCreator,
            channels: {
              cache: new Map([
                [CHANNEL_A, voiceChannel(CHANNEL_A)],
                [CHANNEL_B, voiceChannel(CHANNEL_B)],
              ]),
            },
          },
        ],
      ]),
    },
  } as unknown as Client;
}

beforeEach(() => {
  resetNative();
  preflight.mockReset();
  preflight.mockResolvedValue(undefined);
  preflightFactory.mockClear();
});

adapterLifecycleSuite("DiscordJSAdapter", (): AdapterLifecycleBridge => {
  const adapter = new DiscordJSAdapter(client());
  return {
    createVoiceSession: target => adapter.createVoiceSession(target),
    connection: () => latest.connection,
  };
});

describe("DiscordJSAdapter prerequisite preflight", () => {
  it("rejects voices.join before native gateway work when encryption is unavailable", async () => {
    preflight.mockRejectedValueOnce(new DisTubeError("VOICE_FAILED", "@distube/discordjs requires sodium"));
    const distube = new DisTube({ adapter: new DiscordJSAdapter(client()), sources: [] });

    await expect(distube.voices.join({ guildId: GUILD, id: CHANNEL_A })).rejects.toMatchObject({
      code: "VOICE_FAILED",
    });
    expect(native.joinVoiceChannel).not.toHaveBeenCalled();
  });
});
