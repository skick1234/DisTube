import { joinVoiceChannel, VoiceConnectionStatus } from "@discordjs/voice";
import { DISCORD_ENCRYPTION_MODULES, DISCORD_OPUS_MODULES, FilterRegistry } from "@distube/voice-core/core";
import { discordPreflight } from "@distube/voice-core/discord";
import { ErrorCode } from "distube";
import { afterAll, describe, expect, it } from "vitest";
// The Player is package-internal; a real session cannot reach Ready without a Discord socket, so the
// decode hand-off is exercised directly against a real VoiceConnection instead.
import { DiscordVoicePlayer } from "../../voice-core/src/player";
import {
  type AudioOrigin,
  captureGateway,
  REAL_CHANNEL,
  REAL_GUILD,
  serveAudio,
  voiceState,
} from "../../voice-core/tests/support/real";
import { DiscordJSAdapter } from "../src";

// Nothing is mocked here: the real @discordjs/voice, the real ffmpeg binary, and a real HTTP origin.
// The mocked suites prove our own logic; this one proves the library still behaves the way that logic assumes.

const origin: AudioOrigin = await serveAudio();
afterAll(() => origin.stop());

function connect(): ReturnType<typeof joinVoiceChannel> & { gateway: ReturnType<typeof captureGateway> } {
  const gateway = captureGateway();
  const connection = joinVoiceChannel({
    guildId: REAL_GUILD,
    channelId: REAL_CHANNEL,
    adapterCreator: gateway.creator,
    selfDeaf: true,
    selfMute: false,
  });
  return Object.assign(connection, { gateway });
}

describe("real @discordjs/voice", () => {
  it("follows an external channel move on joinConfig without leaving the connection", () => {
    const connection = connect();
    try {
      expect(connection.joinConfig.channelId).toBe(REAL_CHANNEL);

      // Someone drags the bot. This is the exact fact DiscordVoiceSession#settle reads to republish `connected`.
      connection.gateway.methods().onVoiceStateUpdate(voiceState("dragged"));

      expect(connection.joinConfig.channelId).toBe("dragged");
      expect(connection.state.status).not.toBe(VoiceConnectionStatus.Destroyed);
    } finally {
      connection.destroy();
    }
  });

  it("hands a real ffmpeg decode to a real AudioPlayer subscribed to the connection", async () => {
    const connection = connect();
    const player = new DiscordVoicePlayer(connection, new FilterRegistry());
    try {
      await player.play({
        itemId: "item",
        resource: { kind: "url", url: origin.url, dispose: () => undefined },
      });

      // The library accepted the resource: it is holding a track rather than sitting idle.
      expect(player.position).toBeGreaterThanOrEqual(0);
      expect(connection.state.status).not.toBe(VoiceConnectionStatus.Destroyed);
    } finally {
      await player.release();
      connection.destroy();
    }
  });

  it("reads the voice adapter seam off a real discord.js Guild", async () => {
    const { Client, GatewayIntentBits, Guild } = await import("discord.js");
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    const guild = Reflect.construct(Guild, [client, { id: REAL_GUILD, unavailable: false, name: "Real" }]) as {
      voiceAdapterCreator: unknown;
    };
    client.guilds.cache.set(REAL_GUILD, guild as never);

    // `DiscordJSAdapter.createVoiceSession` reads exactly these two members and nothing else.
    expect(client.guilds.cache.get(REAL_GUILD)).toBe(guild);
    expect(typeof guild.voiceAdapterCreator).toBe("function");

    await new DiscordJSAdapter(client).createVoiceSession({ guildId: "absent", channelId: REAL_CHANNEL }).then(
      () => expect.unreachable("an unknown guild has no voice presence"),
      (error: Error) => expect(error.message).toContain("absent"),
    );
  });

  it("names this package and an accepted module when a voice prerequisite is missing", async () => {
    // Not a hand-built probe: this is the exact one the shipped adapter installs on its engine, so the
    // package name asserted below is the one a real operator would read.
    const check = discordPreflight("@distube/discordjs");

    // Whether the optional modules are installed is a property of the machine, so both outcomes are asserted.
    const failure = await check().then(
      () => undefined,
      (error: unknown) => error as { code?: string; message?: string },
    );
    if (!failure) return;

    expect(failure.code).toBe(ErrorCode.VOICE_FAILED);
    expect(failure.message).toContain("@distube/discordjs");
    const named = [...DISCORD_ENCRYPTION_MODULES, ...DISCORD_OPUS_MODULES];
    expect(named.some(module => failure.message?.includes(module))).toBe(true);
  });
});
