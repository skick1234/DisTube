import { FilterRegistry } from "@distube/voice-core/core";
import type { PlayerEvent, VoiceSessionEvent } from "distube/integrations";
import { Client, VoiceConnection } from "eris";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createMedia, fileReader, type MediaFixtures } from "../../voice-core/tests/support/media";
import { type AudioOrigin, serveAudio } from "../../voice-core/tests/support/real";
import { ErisVoicePlayer } from "../src/player";
import { ErisVoiceSession, suppressTransportVoiceState } from "../src/session";

// Nothing is mocked here: the real Eris Client and VoiceConnection, the real node-av binding, and a real
// HTTP origin. The mocked suites prove our logic; this one proves Eris still behaves the way it assumes.

const GUILD = "real-guild";
const CHANNEL = "real-channel";
const GATEWAY = { channelId: CHANNEL, sessionId: "real-session", token: "real-token", endpoint: "voice.real.example" };

const origin: AudioOrigin = await serveAudio();
const media: MediaFixtures = await createMedia();
afterAll(() => Promise.all([origin.stop(), media.cleanup()]));

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

/** A real connection past its handshake, whose sent audio frames land in `frames` instead of a UDP socket. */
function readyConnection(): { connection: VoiceConnection; frames: Buffer[] } {
  const connection = realConnection();
  const frames: Buffer[] = [];
  Reflect.set(connection, "ready", true);
  Reflect.set(connection, "sendAudioFrame", (frame: Buffer) => frames.push(frame));
  return { connection, frames };
}

describe("real Eris", () => {
  it("reads its gateway credentials and channel off the real client's rawWS emitter", async () => {
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

    expect(session.gateway).toBeUndefined();
    client.emit("rawWS", {
      op: 0,
      t: "VOICE_SERVER_UPDATE",
      d: { guild_id: GUILD, token: "moved-token", endpoint: "moved.example" },
    } as never);

    expect(session.channelId).toBe("dragged");
    expect(events.at(-1)).toEqual({
      type: "connected",
      channelId: "dragged",
      gateway: {
        ...GATEWAY,
        channelId: "dragged",
        token: "moved-token",
        endpoint: "moved.example",
      },
    });
    expect(events.some(event => event.type === "disconnected")).toBe(false);
    await session.release().catch(() => undefined);
  });

  it("keeps gateway membership when a real Eris transport disconnects", async () => {
    const client = realClient();
    const sendWS = vi.fn();
    client.guilds.set(GUILD, { shard: { sendWS } } as never);
    const session = new ErisVoiceSession({
      client,
      guildId: GUILD,
      channelId: CHANNEL,
      clientUserId: "bot",
      selfDeaf: true,
      selfMute: false,
      connectionTimeoutMs: 50,
    });
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

    const transport = realConnection();
    suppressTransportVoiceState(transport);
    transport.disconnect();
    expect(sendWS).not.toHaveBeenCalled();
    expect(session.gateway).toEqual(GATEWAY);

    await session.release();
    expect(sendWS).toHaveBeenCalledExactlyOnceWith(4, {
      guild_id: GUILD,
      channel_id: null,
      self_deaf: true,
      self_mute: false,
    });
  });

  it("decodes with node-av and surfaces Eris's own refusal on a connection that is not ready", async () => {
    const connection = realConnection();
    const player = new ErisVoicePlayer(connection, new FilterRegistry());
    try {
      await expect(
        player.play({ itemId: "item", resource: { kind: "url", url: origin.url, dispose: () => undefined } }),
      ).rejects.toThrow("Not ready yet");

      expect(connection.playing).toBe(false);
      expect(player.position).toBe(0);
    } finally {
      await player.release();
    }
  });

  it("plays a short track to one natural completion", async () => {
    const { connection, frames } = readyConnection();
    const player = new ErisVoicePlayer(connection, new FilterRegistry());
    const events: PlayerEvent[] = [];
    player.subscribe(event => events.push(event));
    try {
      await player.play({ itemId: "item", resource: { kind: "url", url: origin.url, dispose: () => undefined } });

      await vi.waitFor(() => expect(events).toEqual([{ type: "finished", itemId: "item" }]), { timeout: 5000 });
      expect(frames.length).toBeGreaterThanOrEqual(50);
      expect(connection.playing).toBe(false);
    } finally {
      await player.release();
    }
  });

  it("reads a long track at Eris's pace and reports the time Eris has sent", async () => {
    const { connection, frames } = readyConnection();
    const player = new ErisVoicePlayer(connection, new FilterRegistry());
    const reader = await fileReader(media.hour);
    try {
      await player.play({ itemId: "item", resource: reader.resource });

      await vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(75), { timeout: 5000 });
      expect(Math.abs(player.position - frames.length * 0.02)).toBeLessThan(0.1);
      expect(reader.delivered).toBeLessThan(2_000_000);
    } finally {
      await player.release();
    }
  });
});
