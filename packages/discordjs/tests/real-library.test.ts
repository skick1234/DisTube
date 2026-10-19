import { generateDependencyReport, joinVoiceChannel, VoiceConnectionStatus } from "@discordjs/voice";
import { DISCORD_ENCRYPTION_MODULES, FilterRegistry } from "@distube/voice-core/core";

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
// The Oceanic adapter drives the same @discordjs/voice connection and voice-core Player, so these cover it too.

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

  it("exposes voiceAdapterCreator on a real discord.js Guild and refuses an absent guild", async () => {
    const { Client, GatewayIntentBits, Guild } = await import("discord.js");
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    const guild = Reflect.construct(Guild, [client, { id: REAL_GUILD, unavailable: false, name: "Real" }]) as {
      voiceAdapterCreator: unknown;
    };

    // `DiscordJSAdapter.createVoiceSession` hands this member to @discordjs/voice as the gateway adapter.
    expect(typeof guild.voiceAdapterCreator).toBe("function");

    await new DiscordJSAdapter(client).createVoiceSession({ guildId: "absent", channelId: REAL_CHANNEL }).then(
      () => expect.unreachable("an unknown guild has no voice presence"),
      (error: Error) => expect(error.message).toContain("absent"),
    );
  });

  it("preflights the encryption modules @discordjs/voice reports, in its order", () => {
    // The report lists each module the library probes; the native crypto line is not an installable module.
    const lines = generateDependencyReport().split("\n");
    const start = lines.indexOf("Encryption Libraries") + 1;
    const reported = lines
      .slice(start, lines.indexOf("", start))
      .filter(line => !line.includes("native crypto support"))
      .map(line => line.replace(/^- /, "").replace(/: .*$/, ""));

    expect(reported).toEqual([...DISCORD_ENCRYPTION_MODULES]);
  });
});
