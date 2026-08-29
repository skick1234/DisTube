import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import { VoiceConnectionDisconnectReason, VoiceConnectionStatus } from "@discordjs/voice";
import type { VoiceSessionEvent } from "distube";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceSession } from "../src/discord";
import { CHANNEL, GATEWAY, latest, native, readyState, resetNative, settle } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const GUILD = "guild";
const OPTIONS = {
  guildId: GUILD,
  channelId: CHANNEL,
  clientUserId: "bot",
  adapterCreator: (() => ({})) as unknown as DiscordGatewayAdapterCreator,
  selfDeaf: true,
  selfMute: false,
  connectionTimeoutMs: 50,
};

/** Drops the connection the way the gateway would, so the session classifies the reason. */
function disconnect(reason: VoiceConnectionDisconnectReason, closeCode?: number): void {
  latest.connection.transition({ status: VoiceConnectionStatus.Disconnected, reason, closeCode });
}

beforeEach(resetNative);

describe("session lifecycle", () => {
  it("joins the requested channel and exposes the settled gateway data", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);

    expect(native.joinVoiceChannel).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: GUILD, channelId: CHANNEL, selfDeaf: true, selfMute: false }),
    );
    expect(native.entersState).toHaveBeenCalledWith(latest.connection, VoiceConnectionStatus.Ready, 50);
    expect(session.guildId).toBe(GUILD);
    expect(session.clientUserId).toBe("bot");
    expect(session.channelId).toBe(CHANNEL);
    expect(session.gateway).toEqual(GATEWAY);
  });

  it("tears the connection down when it never becomes ready", async () => {
    native.entersState.mockRejectedValueOnce(new Error("connection timed out"));

    await expect(DiscordVoiceSession.connect(OPTIONS)).rejects.toThrow("connection timed out");
    expect(latest.connection.destroy).toHaveBeenCalledTimes(1);
  });

  it("moves to another channel and stays put for the one it already occupies", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);

    await session.join("other");
    expect(latest.connection.rejoin).toHaveBeenCalledWith({ channelId: "other", selfDeaf: true, selfMute: false });
    expect(session.channelId).toBe("other");

    await session.join("other");
    expect(latest.connection.rejoin).toHaveBeenCalledTimes(1);
  });

  it("fails a move the gateway refuses, and every join after release", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    latest.connection.rejoin.mockReturnValueOnce(false);

    await expect(session.join("other")).rejects.toThrow(`Discord gateway is unavailable for guild ${GUILD}`);

    await session.release();
    await expect(session.join("other")).rejects.toThrow("was released");
    expect(session.subscribe(vi.fn())).toBeInstanceOf(Function);
  });

  it("publishes a changed connection to its subscribers, isolating a failing one", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const failing = vi.fn(() => {
      throw new Error("subscriber failed");
    });
    const events: VoiceSessionEvent[] = [];
    session.subscribe(failing);
    const unsubscribe = session.subscribe(event => events.push(event));

    latest.connection.transition(readyState({ token: "rotated" }));
    expect(failing).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "connected", channelId: CHANNEL, gateway: { ...GATEWAY, token: "rotated" } }]);

    // An unchanged settle publishes nothing, and an unsubscribed listener hears nothing at all.
    latest.connection.transition(readyState({ token: "rotated" }));
    unsubscribe();
    latest.connection.transition(readyState({ token: "again" }));
    expect(events).toHaveLength(1);
  });

  it("ends the guild's presence once when the connection is destroyed", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const listener = vi.fn();
    session.subscribe(listener);

    latest.connection.transition({ status: VoiceConnectionStatus.Destroyed });
    await settle();

    expect(listener).toHaveBeenCalledWith({ type: "disconnected", error: expect.any(Error) });
    expect(session.gateway).toBeUndefined();
    expect(session.release()).toBe(session.release());
    // The connection is already gone, so release has nothing left to destroy.
    expect(latest.connection.destroy).not.toHaveBeenCalled();
    latest.connection.transition({ status: VoiceConnectionStatus.Destroyed });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("disconnect classification", () => {
  it("treats a 4014 close that re-signals as a move", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const listener = vi.fn();
    session.subscribe(listener);

    disconnect(VoiceConnectionDisconnectReason.WebSocketClose, 4014);
    await settle();

    expect(listener).not.toHaveBeenCalled();
  });

  it("republishes connected with the new channel once an external move settles", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const events: VoiceSessionEvent[] = [];
    session.subscribe(event => events.push(event));

    disconnect(VoiceConnectionDisconnectReason.WebSocketClose, 4014);
    // `addStatePacket` writes the channel Discord put us in straight onto joinConfig.
    latest.connection.joinConfig = { channelId: "dragged" };
    latest.connection.transition(readyState({ endpoint: "moved.example" }, "dragged"));
    await settle();

    expect(session.channelId).toBe("dragged");
    expect(events).toEqual([
      { type: "connected", channelId: "dragged", gateway: { ...GATEWAY, endpoint: "moved.example" } },
    ]);
  });

  const TERMINAL: readonly (readonly [string, VoiceConnectionDisconnectReason, number | undefined, string])[] = [
    ["a 4014 close that never re-signals", VoiceConnectionDisconnectReason.WebSocketClose, 4014, "removed guild"],
    ["a manual disconnect", VoiceConnectionDisconnectReason.Manual, undefined, "was disconnected"],
    ["an unavailable adapter", VoiceConnectionDisconnectReason.AdapterUnavailable, undefined, "gateway is unavailable"],
  ];

  it.each(TERMINAL)("ends the presence on %s", async (_case, reason, closeCode, message) => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const listener = vi.fn();
    session.subscribe(listener);
    // Nothing re-signals after the drop, so a 4014 close reads as a removal rather than a move.
    native.entersState.mockRejectedValue(new Error("no move"));

    disconnect(reason, closeCode);
    await settle();

    expect(listener).toHaveBeenCalledWith({
      type: "disconnected",
      error: expect.objectContaining({ message: expect.stringContaining(message) }),
    });
  });

  it("rejoins a recoverable drop and gives up once its attempts run out", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const listener = vi.fn();
    session.subscribe(listener);

    for (let attempt = 0; attempt < 3; attempt++) disconnect(VoiceConnectionDisconnectReason.EndpointRemoved);
    expect(latest.connection.rejoin).toHaveBeenCalledTimes(3);
    expect(listener).not.toHaveBeenCalled();

    disconnect(VoiceConnectionDisconnectReason.EndpointRemoved);
    expect(latest.connection.rejoin).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledWith({
      type: "disconnected",
      error: expect.objectContaining({ message: expect.stringContaining("could not be recovered") }),
    });
  });

  it("ends the presence when the gateway refuses a recovery rejoin", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const listener = vi.fn();
    session.subscribe(listener);
    latest.connection.rejoin.mockReturnValueOnce(false);

    disconnect(VoiceConnectionDisconnectReason.EndpointRemoved);

    expect(listener).toHaveBeenCalledWith({
      type: "disconnected",
      error: expect.objectContaining({ message: expect.stringContaining("gateway is unavailable") }),
    });
  });
});

describe("release", () => {
  it("preserves a single native cleanup failure", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    latest.connection.destroy.mockImplementationOnce(() => {
      throw new Error("destroy failed");
    });

    await expect(session.release()).rejects.toThrow("destroy failed");
  });

  it("attempts every cleanup unit and aggregates their failures", async () => {
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const connection = latest.connection;
    vi.spyOn(connection, "off").mockImplementation(() => {
      throw new Error("listener removal failed");
    });
    connection.destroy.mockImplementationOnce(() => {
      throw new Error("destroy failed");
    });

    const failure = await session.release().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      "listener removal failed",
      "destroy failed",
    ]);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });
});
