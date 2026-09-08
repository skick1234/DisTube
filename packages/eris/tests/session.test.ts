import type { VoiceSessionEvent } from "distube/integrations";
import { describe, expect, it, vi } from "vitest";
import { ErisVoiceSession } from "../src/session";
import {
  announce,
  announceServer,
  announceState,
  asClient,
  CHANNEL,
  FakeClient,
  FakeVoiceConnection,
  GATEWAY,
  GUILD,
  settle,
  voiceChannel,
} from "./support/eris";

const OPTIONS = {
  guildId: GUILD,
  channelId: CHANNEL,
  clientUserId: "bot",
  selfDeaf: true,
  selfMute: false,
  connectionTimeoutMs: 50,
};

function connect(client: FakeClient, overrides: Partial<typeof OPTIONS> = {}): Promise<ErisVoiceSession> {
  return ErisVoiceSession.connect({ client: asClient(client), ...OPTIONS, ...overrides });
}

/** A connected session plus the events it publishes from that point on. */
async function connected(client: FakeClient): Promise<{ session: ErisVoiceSession; events: VoiceSessionEvent[] }> {
  const session = await connect(client);
  const events: VoiceSessionEvent[] = [];
  session.subscribe(event => events.push(event));
  return { session, events };
}

describe("connecting", () => {
  it("joins the requested channel and publishes once both halves of the credentials land", async () => {
    const client = new FakeClient();
    const { session, events } = await connected(client);

    expect(client.joinVoiceChannel).toHaveBeenCalledWith(CHANNEL, { selfDeaf: true, selfMute: false });
    expect(session.guildId).toBe(GUILD);
    expect(session.clientUserId).toBe(client.user.id);
    expect(session.channelId).toBe(CHANNEL);

    announceServer(client);
    expect(session.gateway).toBeUndefined();
    announceState(client);

    expect(session.gateway).toEqual(GATEWAY);
    expect(events).toEqual([{ type: "connected", channelId: CHANNEL, gateway: GATEWAY }]);

    // Repeating the same credentials settles nothing new.
    announce(client);
    expect(events).toHaveLength(1);
  });

  it("ignores gateway traffic that is not this guild's own presence", async () => {
    const client = new FakeClient();
    const { session } = await connected(client);

    announce(client, GATEWAY, "other-guild");
    client.emit("rawWS", { t: "VOICE_SERVER_UPDATE", d: { guild_id: GUILD, token: 7, endpoint: "voice.example" } });
    client.emit("rawWS", { t: "VOICE_STATE_UPDATE", d: { guild_id: GUILD, user_id: "someone-else", session_id: "s" } });
    client.emit("rawWS", { t: "MESSAGE_CREATE", d: { guild_id: GUILD } });
    client.emit("rawWS", { t: "VOICE_SERVER_UPDATE", d: null });

    expect(session.gateway).toBeUndefined();
  });

  it("refuses a channel that is missing or belongs to another guild", async () => {
    const client = new FakeClient();
    client.channels.set("foreign", voiceChannel("other-guild"));
    const { session } = await connected(client);

    await expect(session.join("missing")).rejects.toThrow("Eris voice channel is unavailable: missing");
    await expect(session.join("foreign")).rejects.toThrow(`does not belong to guild ${GUILD}`);
    expect(client.joinVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it("gives up on a join the gateway never answers and leaves nothing behind", async () => {
    const client = new FakeClient();
    let arrive: (connection: FakeVoiceConnection) => void = () => undefined;
    client.join = () => new Promise(resolve => (arrive = resolve));

    await expect(connect(client, { connectionTimeoutMs: 5 })).rejects.toThrow("Eris voice connection timed out");

    // The abandoned join is left twice: once on the timeout, once by the failed session's release.
    expect(client.leaveVoiceChannel).toHaveBeenCalledTimes(2);
    arrive(client.connection);
    await settle();
    expect(client.leaveVoiceChannel).toHaveBeenCalledTimes(3);
  });
});

describe("moving", () => {
  it("moves the presence and keeps reporting the channel the connection holds", async () => {
    const client = new FakeClient();
    client.channels.set("other", voiceChannel());
    const { session, events } = await connected(client);
    announce(client);

    await session.join("other");

    expect(client.joinVoiceChannel).toHaveBeenLastCalledWith("other", { selfDeaf: true, selfMute: false });
    expect(session.channelId).toBe("other");
    // Rotated credentials for the new channel are what the subscriber hears about.
    announceServer(client, { ...GATEWAY, token: "rotated" });
    expect(events.at(-1)).toEqual({
      type: "connected",
      channelId: "other",
      gateway: { ...GATEWAY, token: "rotated" },
    });
  });

  it("republishes connected when Discord moves the bot, without a disconnect", async () => {
    const client = new FakeClient();
    const { session, events } = await connected(client);
    announce(client);
    expect(events).toHaveLength(1);

    // Someone with the permission drags the bot; the new credentials follow the state packet.
    announceState(client, GATEWAY, GUILD, "dragged");
    announceServer(client, { ...GATEWAY, endpoint: "moved.example" });

    expect(session.channelId).toBe("dragged");
    // The new channel is news on its own, and so is the endpoint that follows it.
    expect(events).toEqual([
      { type: "connected", channelId: CHANNEL, gateway: GATEWAY },
      { type: "connected", channelId: "dragged", gateway: GATEWAY },
      { type: "connected", channelId: "dragged", gateway: { ...GATEWAY, endpoint: "moved.example" } },
    ]);
    expect(client.joinVoiceChannel).toHaveBeenCalledTimes(1);
  });

  it("reports a null channel as the end of the guild's presence", async () => {
    const client = new FakeClient();
    const { session, events } = await connected(client);
    announce(client);

    announceState(client, GATEWAY, GUILD, null);
    await settle();

    expect(events.at(-1)).toEqual({
      type: "disconnected",
      error: expect.objectContaining({ message: expect.stringContaining("removed") }),
    });
    expect(session.gateway).toBeUndefined();
  });

  it("restores the committed native channel after a rejected move mutates it", async () => {
    const client = new FakeClient();
    client.channels.set("other", voiceChannel());
    const { session } = await connected(client);
    const failure = new Error("move failed");
    client.join = async channelId => {
      client.connection.channelID = channelId;
      if (channelId === "other") throw failure;
      return client.connection;
    };

    await expect(session.join("other")).rejects.toBe(failure);

    expect(session.channelId).toBe(CHANNEL);
    expect(client.connection.channelID).toBe(CHANNEL);
    expect(client.joinVoiceChannel).toHaveBeenNthCalledWith(2, "other", { selfDeaf: true, selfMute: false });
    expect(client.joinVoiceChannel).toHaveBeenNthCalledWith(3, CHANNEL, { selfDeaf: true, selfMute: false });
  });

  it("restores the committed native channel after a timed-out move mutates it", async () => {
    vi.useFakeTimers();
    try {
      const client = new FakeClient();
      client.channels.set("other", voiceChannel());
      const session = await connect(client, { connectionTimeoutMs: 5 });
      client.join = channelId => {
        client.connection.channelID = channelId;
        if (channelId === "other") return new Promise(() => undefined);
        return Promise.resolve(client.connection);
      };

      const moving = session.join("other");
      const rejection = expect(moving).rejects.toThrow("Eris voice connection timed out");
      await vi.advanceTimersByTimeAsync(5);

      await rejection;
      expect(session.channelId).toBe(CHANNEL);
      expect(client.connection.channelID).toBe(CHANNEL);
      expect(client.joinVoiceChannel).toHaveBeenNthCalledWith(2, "other", { selfDeaf: true, selfMute: false });
      expect(client.joinVoiceChannel).toHaveBeenNthCalledWith(3, CHANNEL, { selfDeaf: true, selfMute: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminalizes when restoring a mutated native move fails", async () => {
    const client = new FakeClient();
    client.channels.set("other", voiceChannel());
    const { session, events } = await connected(client);
    const moveFailure = new Error("move failed");
    const restoreFailure = new Error("restore failed");
    client.join = async channelId => {
      client.connection.channelID = channelId;
      if (channelId === "other") throw moveFailure;
      throw restoreFailure;
    };

    const failure = await session.join("other").catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([moveFailure, restoreFailure]);
    expect(events).toEqual([{ type: "disconnected", error: failure }]);
    await expect(session.join(CHANNEL)).rejects.toThrow("was released");
    expect(client.leaveVoiceChannel).toHaveBeenCalledWith(CHANNEL);
  });

  it("stops listening to the connection it moved off", async () => {
    const client = new FakeClient();
    client.channels.set("other", voiceChannel());
    const { session, events } = await connected(client);
    const abandoned = client.connection;
    client.connection = new FakeVoiceConnection();

    await session.join("other");
    abandoned.emit("disconnect", new Error("old connection dropped"));

    expect(events).toEqual([]);
    expect(session.channelId).toBe("other");
  });
});

describe("ending", () => {
  it("reports a terminal disconnect once and refuses every later request", async () => {
    const client = new FakeClient();
    const { session, events } = await connected(client);

    client.connection.emit("disconnect");
    await settle();

    expect(events).toEqual([
      { type: "disconnected", error: expect.objectContaining({ message: expect.stringContaining("disconnected") }) },
    ]);
    expect(session.gateway).toBeUndefined();
    expect(client.leaveVoiceChannel).toHaveBeenCalledWith(CHANNEL);

    client.connection.emit("disconnect", new Error("again"));
    announce(client);
    expect(events).toHaveLength(1);
    await expect(session.join(CHANNEL)).rejects.toThrow("was released");
    expect(session.subscribe(vi.fn())).toBeInstanceOf(Function);
  });

  it("isolates a subscriber that throws", async () => {
    const client = new FakeClient();
    const { session, events } = await connected(client);
    session.subscribe(() => {
      throw new Error("subscriber failed");
    });

    announce(client);

    expect(events).toHaveLength(1);
  });

  it("shares one teardown between overlapping releases", async () => {
    const client = new FakeClient();
    const session = await connect(client);

    await Promise.all([session.release(), session.release()]);

    expect(client.leaveVoiceChannel).toHaveBeenCalledTimes(1);
    expect(session.release()).toBe(session.release());
  });

  it("attempts every cleanup unit and aggregates their failures", async () => {
    const client = new FakeClient();
    const session = await connect(client);
    const gatewayFailure = new Error("gateway listener removal failed");
    const connectionFailure = new Error("connection listener removal failed");
    const leaveFailure = new Error("leave failed");
    vi.spyOn(client, "off").mockImplementation(() => {
      throw gatewayFailure;
    });
    vi.spyOn(client.connection, "off").mockImplementation(() => {
      throw connectionFailure;
    });
    client.leaveVoiceChannel.mockImplementationOnce(() => {
      throw leaveFailure;
    });

    const failure = await session.release().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([gatewayFailure, connectionFailure, leaveFailure]);
  });

  it("preserves a single cleanup failure as itself", async () => {
    const client = new FakeClient();
    const session = await connect(client);
    client.leaveVoiceChannel.mockImplementationOnce(() => {
      throw new Error("leave failed");
    });

    await expect(session.release()).rejects.toThrow("leave failed");
  });
});
