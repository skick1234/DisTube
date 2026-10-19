import { VoiceConnectionStatus } from "@discordjs/voice";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../src/engine";
import { DiscordVoiceSession } from "../src/session";
import { CHANNEL, GATEWAY, gatewayAdapter, latest, native, resetNative, settle } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

beforeEach(resetNative);

function options(creator: ReturnType<typeof gatewayAdapter>["creator"]) {
  return {
    guildId: "guild",
    channelId: CHANNEL,
    clientUserId: "bot",
    adapterCreator: creator,
    selfDeaf: true,
    selfMute: false,
    connectionTimeoutMs: 50,
  } as const;
}

describe("gateway session", () => {
  it("joins without constructing audio and publishes a complete copied snapshot", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));

    expect(native.joinVoiceChannel).not.toHaveBeenCalled();
    expect(gateway.sendPayload).toHaveBeenCalledWith({
      op: 4,
      d: { guild_id: "guild", channel_id: CHANNEL, self_deaf: true, self_mute: false },
    });
    expect(session.gateway).toEqual(GATEWAY);
    expect(Object.isFrozen(session.gateway)).toBe(true);
    expect(session.channelId).toBe(CHANNEL);
    expect(session.clientUserId).toBe("bot");
    await session.release();
  });

  it("replays the current snapshot to a late local transport without a second membership request", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    const sent = gateway.sendPayload.mock.calls.length;

    expect(await DiscordVoiceSession.connectionOf(session)).toBe(latest.connection);
    await settle();

    expect(native.transports).toHaveLength(1);
    expect(native.transports[0]?.state).toHaveBeenCalledWith(expect.objectContaining({ channel_id: CHANNEL }));
    expect(native.transports[0]?.server).toHaveBeenCalledWith(expect.objectContaining({ token: GATEWAY.token }));
    expect(gateway.sendPayload).toHaveBeenCalledTimes(sent);
    expect(native.entersState).toHaveBeenCalledWith(latest.connection, VoiceConnectionStatus.Ready, 50);
    await session.release();
  });

  it("replaces a released local Player without leaving the gateway session", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    const engine = new DiscordVoiceEngine(undefined, async () => undefined);
    const first = await engine.createPlayer(session);
    const firstConnection = latest.connection;
    const sent = gateway.sendPayload.mock.calls.length;

    await first.release();
    expect(firstConnection.destroy).toHaveBeenCalledTimes(1);
    expect(session.gateway).toEqual(GATEWAY);
    expect(gateway.sendPayload).toHaveBeenCalledTimes(sent);

    const second = await engine.createPlayer(session);
    expect(latest.connection).not.toBe(firstConnection);
    expect(native.joinVoiceChannel).toHaveBeenCalledTimes(2);
    await second.release();
    await session.release();
    expect(gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id === null)).toHaveLength(1);
  });

  it("waits for both halves after a move and republishes refreshed credentials", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    const events = vi.fn();
    session.subscribe(events);

    gateway.state("dragged", "moved");
    expect(session.gateway).toBeUndefined();
    gateway.server("rotated", "new.example");

    expect(session.gateway).toEqual({
      channelId: "dragged",
      sessionId: "moved",
      token: "rotated",
      endpoint: "new.example",
    });
    expect(events).toHaveBeenCalledExactlyOnceWith({
      type: "connected",
      channelId: "dragged",
      gateway: session.gateway,
    });
    await session.release();
  });

  it("acknowledges self flags and stops delivering updates after unsubscribe", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    const events = vi.fn();
    const unsubscribe = session.subscribe(events);

    await session.setSelfDeaf(false);
    await session.setSelfMute(true);
    expect(session.selfDeaf).toBe(false);
    expect(session.selfMute).toBe(true);
    expect(gateway.sendPayload).toHaveBeenLastCalledWith({
      op: 4,
      d: { guild_id: "guild", channel_id: CHANNEL, self_deaf: false, self_mute: true },
    });

    const delivered = events.mock.calls.length;
    unsubscribe();
    gateway.server("rotated", "next.example");
    expect(session.gateway).toMatchObject({ token: "rotated", endpoint: "next.example" });
    expect(events).toHaveBeenCalledTimes(delivered);
    await session.release();
  });

  it("cancels pending movement when its session leaves", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    gateway.sendPayload.mockImplementationOnce(() => true);

    const moving = session.join("other");
    await session.release();

    await expect(moving).rejects.toThrow("released");
    expect(session.gateway).toBeUndefined();
    expect(gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id === null)).toHaveLength(1);
  });

  it("retires a failed local attachment without losing gateway membership", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    native.entersState.mockRejectedValueOnce(new Error("native readiness failed"));

    await expect(DiscordVoiceSession.connectionOf(session)).rejects.toThrow("native readiness failed");
    expect(latest.connection.destroy).toHaveBeenCalledTimes(1);
    expect(session.gateway).toEqual(GATEWAY);

    const replacement = await DiscordVoiceSession.connectionOf(session);
    expect(replacement).toBe(latest.connection);
    await session.release();
  });

  it("tries every owned cleanup step and preserves distinct failures", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    const sendFailure = new Error("leave failed");
    const destroyFailure = new Error("adapter destroy failed");
    gateway.sendPayload.mockImplementationOnce(() => {
      throw sendFailure;
    });
    gateway.destroy.mockImplementationOnce(() => {
      throw destroyFailure;
    });

    await expect(session.release()).rejects.toMatchObject({
      errors: [sendFailure, destroyFailure],
    });
    expect(gateway.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed snapshot when a move is refused", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    gateway.sendPayload.mockReturnValueOnce(false);

    await expect(session.join("other")).rejects.toThrow("Discord gateway is unavailable");
    expect(session.gateway).toEqual(GATEWAY);
    expect(session.channelId).toBe(CHANNEL);
    await session.release();
  });

  it("suppresses local transport leave and sends one session-owned leave", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    await DiscordVoiceSession.connectionOf(session);
    const nativeBridge = native.transports[0];
    expect(nativeBridge).toBeDefined();

    nativeBridge?.sendPayload({ op: 4, d: { guild_id: "guild", channel_id: null } });
    expect(gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id === null)).toHaveLength(0);

    await Promise.all([session.release(), session.release()]);
    expect(gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id === null)).toHaveLength(1);
    expect(latest.connection.destroy).toHaveBeenCalledTimes(1);
    expect(gateway.destroy).toHaveBeenCalledTimes(1);
  });

  it("treats gateway removal as terminal and isolates listener failures", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    session.subscribe(() => {
      throw new Error("listener failed");
    });
    const events = vi.fn();
    session.subscribe(events);

    gateway.state(null);
    await settle();

    expect(events).toHaveBeenCalledWith({ type: "disconnected", error: expect.any(Error) });
    expect(session.gateway).toBeUndefined();
  });
});
