import {
  createPrerequisiteCheck,
  ERIS_ENCRYPTION_MODULES,
  ERIS_OPUS_MODULES,
  FilterRegistry,
} from "@distube/voice-core/core";
import { ErrorCode, type VoiceSessionEvent } from "distube";
import { Client, VoiceConnection } from "eris";
import { afterAll, describe, expect, it } from "vitest";
import { type AudioOrigin, serveAudio } from "../../voice-core/tests/support/real";
import { ErisVoicePlayer } from "../src/player";
import { ErisVoiceSession } from "../src/session";

// Nothing is mocked here: the real Eris Client and VoiceConnection, the real ffmpeg binary, and a real
// HTTP origin. The mocked suites prove our logic; this one proves Eris still behaves the way it assumes.

const GUILD = "real-guild";
const CHANNEL = "real-channel";
const GATEWAY = { sessionId: "real-session", token: "real-token", endpoint: "voice.real.example" };

const origin: AudioOrigin = await serveAudio();
afterAll(() => origin.stop());

/** A real Eris Client with a bot identity but no gateway, which is all the session reads off it. */
function realClient(): Client {
  const client = new Client("Bot invalid");
  Reflect.set(client, "user", { id: "bot" });
  return client;
}

/** A real Eris VoiceConnection with a stub shard, since the shard only carries gateway payloads. */
function realConnection(): VoiceConnection {
  return new VoiceConnection(GUILD, {
    shard: { sendWS: () => undefined },
    opusOnly: true,
  } as unknown as ConstructorParameters<typeof VoiceConnection>[1]);
}

describe("real Eris", () => {
  it("reads its gateway credentials and channel off the real client's rawWS emitter", () => {
    const client = realClient();
    const session = new ErisVoiceSession({
      client,
      guildId: GUILD,
      channelId: CHANNEL,
      clientUserId: "bot",
      selfDeaf: true,
      selfMute: false,
      connectionTimeoutMs: 50,
    });
    const events: VoiceSessionEvent[] = [];
    session.subscribe(event => events.push(event));

    client.emit("rawWS", {
      op: 0,
      t: "VOICE_SERVER_UPDATE",
      d: { guild_id: GUILD, token: GATEWAY.token, endpoint: GATEWAY.endpoint },
    } as never);
    client.emit("rawWS", {
      op: 0,
      t: "VOICE_STATE_UPDATE",
      d: { guild_id: GUILD, user_id: "bot", session_id: GATEWAY.sessionId, channel_id: CHANNEL },
    } as never);

    expect(session.gateway).toEqual(GATEWAY);
    expect(events).toEqual([{ type: "connected", channelId: CHANNEL, gateway: GATEWAY }]);

    // An external move republishes rather than disconnecting; the active track is untouched.
    client.emit("rawWS", {
      op: 0,
      t: "VOICE_STATE_UPDATE",
      d: { guild_id: GUILD, user_id: "bot", session_id: GATEWAY.sessionId, channel_id: "dragged" },
    } as never);

    expect(session.channelId).toBe("dragged");
    expect(events.at(-1)).toEqual({ type: "connected", channelId: "dragged", gateway: GATEWAY });
    expect(events.some(event => event.type === "disconnected")).toBe(false);
  });

  it("decodes with real ffmpeg and surfaces Eris's own refusal on a connection that is not ready", async () => {
    const connection = realConnection();
    const player = new ErisVoicePlayer(connection, new FilterRegistry());
    try {
      // Real ffmpeg decodes the real HTTP origin; real Eris then refuses the hand-off, and that refusal
      // reaches core instead of a started item over silence.
      await expect(
        player.play({ itemId: "item", resource: { kind: "url", url: origin.url, dispose: () => undefined } }),
      ).rejects.toThrow("Not ready yet");

      expect(connection.playing).toBe(false);
      expect(player.position).toBe(0);
    } finally {
      await player.release();
    }
  });

  it("rejects seek with UNSUPPORTED, because the real Eris voice API cannot seek", async () => {
    const player = new ErisVoicePlayer(realConnection(), new FilterRegistry());
    try {
      await expect(player.seek(10)).rejects.toMatchObject({ code: ErrorCode.UNSUPPORTED });
    } finally {
      await player.release();
    }
  });

  it("names this package and an accepted module when a voice prerequisite is missing", async () => {
    const check = createPrerequisiteCheck({
      owner: "@distube/eris",
      encryption: ERIS_ENCRYPTION_MODULES,
      opus: ERIS_OPUS_MODULES,
    });

    // Whether the optional modules are installed is a property of the machine, so both outcomes are asserted.
    const failure = await check().then(
      () => undefined,
      (error: unknown) => error as { code?: string; message?: string },
    );
    if (!failure) return;

    expect(failure.code).toBe(ErrorCode.VOICE_FAILED);
    expect(failure.message).toContain("@distube/eris");
    const named = [...ERIS_ENCRYPTION_MODULES, ...ERIS_OPUS_MODULES];
    expect(named.some(module => failure.message?.includes(module))).toBe(true);
  });
});
