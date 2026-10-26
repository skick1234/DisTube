import { VoiceConnectionStatus } from "@discordjs/voice";
import type { VoiceSessionEvent } from "distube/integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../src/engine";
import { DiscordVoiceSession } from "../src/session";
import { CHANNEL, GATEWAY, gatewayAdapter, latest, native, resetNative, settle } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

beforeEach(resetNative);
afterEach(() => {
  vi.useRealTimers();
});

function options(
  creator: ReturnType<typeof gatewayAdapter>["creator"],
  preflight: (channelId: string) => void = () => undefined,
) {
  return {
    guildId: "guild",
    channelId: CHANNEL,
    clientUserId: "bot",
    adapterCreator: creator,
    selfDeaf: true,
    selfMute: false,
    timeoutMs: 50,
    channelBitrate: (channelId: string) => (channelId === CHANNEL ? 64_000 : 96_000),
    preflight,
  } as const;
}

function joins(gateway: ReturnType<typeof gatewayAdapter>): unknown[] {
  return gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id !== null);
}

function leaves(gateway: ReturnType<typeof gatewayAdapter>): unknown[] {
  return gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id === null);
}

async function subscribed(gateway: ReturnType<typeof gatewayAdapter>): Promise<{
  session: DiscordVoiceSession;
  events: VoiceSessionEvent[];
}> {
  const session = await DiscordVoiceSession.connect(options(gateway.creator));
  const events: VoiceSessionEvent[] = [];
  session.subscribe(event => events.push(event));
  return { session, events };
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
    const engine = new DiscordVoiceEngine({ opusComplexity: 10, bufferMs: 500 });
    const first = await engine.createPlayer(session, { onClosed: () => undefined });
    const firstConnection = latest.connection;
    const sent = gateway.sendPayload.mock.calls.length;

    await first.release();
    expect(firstConnection.destroy).toHaveBeenCalledTimes(1);
    expect(session.gateway).toEqual(GATEWAY);
    expect(gateway.sendPayload).toHaveBeenCalledTimes(sent);

    const second = await engine.createPlayer(session, { onClosed: () => undefined });
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

  it("reads the bitrate of the channel it settled in, including after a move", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    const before = session.bitrate;

    await session.join("other");

    expect(before).toBe(64_000);
    expect(session.bitrate).toBe(96_000);
    await session.release();
  });

  it("acknowledges self flags sent through join and stops delivering updates after unsubscribe", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    const events = vi.fn();
    const unsubscribe = session.subscribe(events);

    await session.join(CHANNEL, { selfDeaf: false });
    await session.join(CHANNEL, { selfMute: true });
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

  it("rejects a join its preflight refuses before any gateway payload", async () => {
    const gateway = gatewayAdapter();
    const refused = new Error("denies the bot Connect");

    await expect(
      DiscordVoiceSession.connect(
        options(gateway.creator, () => {
          throw refused;
        }),
      ),
    ).rejects.toBe(refused);
    expect(gateway.sendPayload).not.toHaveBeenCalled();
  });

  it("rejects a move its preflight refuses before any gateway payload and keeps the held channel", async () => {
    const gateway = gatewayAdapter();
    const preflight = vi.fn((channelId: string) => {
      if (channelId === "full") throw new Error("is full");
    });
    const session = await DiscordVoiceSession.connect(options(gateway.creator, preflight));
    gateway.sendPayload.mockClear();

    await expect(session.join("full")).rejects.toThrow("is full");
    await session.setSelfState({ selfMute: true });

    expect(preflight.mock.calls).toEqual([[CHANNEL], ["full"]]);
    expect(gateway.sendPayload.mock.calls).toEqual([
      [{ op: 4, d: { guild_id: "guild", channel_id: CHANNEL, self_deaf: true, self_mute: true } }],
    ]);
    expect(session.channelId).toBe(CHANNEL);
    expect(session.gateway).toEqual(GATEWAY);
    expect(session.selfMute).toBe(true);
    await session.release();
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

  it.each([
    ["join", (session: DiscordVoiceSession) => session.join(CHANNEL, { selfMute: true })],
    ["setSelfState", (session: DiscordVoiceSession) => session.setSelfState({ selfMute: true })],
  ])(
    "sends a %s flag write behind an unanswered move only after the move times out, in the channel still held",
    async (_name, write) => {
      const gateway = gatewayAdapter();
      const session = await DiscordVoiceSession.connect(options(gateway.creator));
      gateway.sendPayload.mockImplementationOnce(() => true);

      const moving = session.join("other");
      const muting = write(session);
      void moving.catch(() => undefined);
      await settle();

      expect(gateway.sendPayload.mock.calls.map(([payload]) => payload.d)).toEqual([
        { guild_id: "guild", channel_id: CHANNEL, self_deaf: true, self_mute: false },
        { guild_id: "guild", channel_id: "other", self_deaf: true, self_mute: false },
      ]);
      await expect(moving).rejects.toThrow("timed out");
      await muting;
      expect(gateway.sendPayload).toHaveBeenLastCalledWith({
        op: 4,
        d: { guild_id: "guild", channel_id: CHANNEL, self_deaf: true, self_mute: true },
      });
      expect(session.gateway).toEqual(GATEWAY);
      expect(session.channelId).toBe(CHANNEL);
      expect(session.selfMute).toBe(true);
      await session.release();
    },
  );

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

  it("reports a removal while not leaving as a removed disconnect and isolates listener failures", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordVoiceSession.connect(options(gateway.creator));
    session.subscribe(() => {
      throw new Error("listener failed");
    });
    const events = vi.fn();
    session.subscribe(events);

    gateway.state(null);
    await settle();

    expect(events.mock.calls).toEqual([[{ type: "disconnected", reason: "removed" }]]);
    expect(session.gateway).toBeUndefined();
  });

  it("releases a pending join and rejects ABORTED with the reason as soon as its signal aborts", async () => {
    const gateway = gatewayAdapter();
    gateway.sendPayload.mockImplementationOnce(() => true);
    const controller = new AbortController();
    let failure: unknown;
    const connecting = DiscordVoiceSession.connect({
      ...options(gateway.creator),
      timeoutMs: 60_000,
      signal: controller.signal,
    }).catch((error: unknown) => void (failure = error));
    await settle();
    const reason = new Error("left");
    controller.abort(reason);
    await settle();

    expect(failure).toMatchObject({ code: "ABORTED", cause: reason });
    expect(gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id === null)).toHaveLength(1);
    expect(gateway.destroy).toHaveBeenCalledTimes(1);
    await connecting;
  });

  it("rejects ABORTED and leaves once when the signal aborts in the tick the platform acknowledges", async () => {
    const gateway = gatewayAdapter();
    const controller = new AbortController();
    const reason = new Error("left");
    gateway.sendPayload.mockImplementationOnce(() => {
      queueMicrotask(() => {
        gateway.state(CHANNEL);
        gateway.server();
        controller.abort(reason);
      });
      return true;
    });

    await expect(
      DiscordVoiceSession.connect({ ...options(gateway.creator), timeoutMs: 60_000, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED", cause: reason });
    expect(leaves(gateway)).toHaveLength(1);
    expect(gateway.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects an already aborted join ABORTED without touching the gateway", async () => {
    const gateway = gatewayAdapter();
    const controller = new AbortController();
    const reason = new Error("left");
    controller.abort(reason);

    await expect(
      DiscordVoiceSession.connect({ ...options(gateway.creator), signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED", cause: reason });
    expect(gateway.sendPayload).not.toHaveBeenCalled();
    expect(gateway.destroy).not.toHaveBeenCalled();
  });
});

describe("voice close recovery", () => {
  it.each([
    ["inside", 59_999, true],
    ["after", 60_000, false],
  ])(
    "after three rejoins, a fourth close %s the 60 s window disconnects only inside it",
    async (_when, elapsedMs, disconnects) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const gateway = gatewayAdapter();
      const { session, events } = await subscribed(gateway);

      for (const code of [4006, 4009, 4006]) {
        session.voiceClosed(code);
        await settle();
      }
      expect(events).toEqual(
        Array.from({ length: 3 }, () => ({ type: "connected", channelId: CHANNEL, gateway: GATEWAY })),
      );
      vi.advanceTimersByTime(elapsedMs);
      session.voiceClosed(4009);
      await settle();

      expect(events.slice(3).filter(event => event.type === "disconnected")).toEqual(
        disconnects ? [{ type: "disconnected", reason: "failed", error: expect.any(Error) }] : [],
      );
      expect(joins(gateway)).toHaveLength(disconnects ? 4 : 5);
      await session.release();
    },
  );

  it.each([4004, 4011, 4016, 4017, 4021, 4022])(
    "publishes one disconnect naming %i without a join, then ignores later closes",
    async code => {
      const gateway = gatewayAdapter();
      const { session, events } = await subscribed(gateway);

      session.voiceClosed(code);
      session.voiceClosed(4006);
      await settle();

      expect(events).toEqual([
        {
          type: "disconnected",
          reason: "failed",
          error: expect.objectContaining({ message: expect.stringContaining(String(code)) }),
        },
      ]);
      expect(joins(gateway)).toHaveLength(1);
      expect(leaves(gateway)).toHaveLength(1);
    },
  );

  it("publishes one disconnect when the gateway cannot send a rejoin", async () => {
    const gateway = gatewayAdapter();
    const { session, events } = await subscribed(gateway);
    gateway.sendPayload.mockReturnValueOnce(false);

    session.voiceClosed(4006);
    await settle();

    expect(events).toEqual([{ type: "disconnected", reason: "failed", error: expect.any(Error) }]);
    expect(session.gateway).toBeUndefined();
  });

  it("returns false to the library and disconnects once when the gateway refuses its rejoin", async () => {
    const gateway = gatewayAdapter();
    const { session, events } = await subscribed(gateway);
    await DiscordVoiceSession.connectionOf(session);
    gateway.sendPayload.mockReturnValueOnce(false);

    const sent = native.transports[0]?.sendPayload({
      op: 4,
      d: { guild_id: "guild", channel_id: CHANNEL, self_deaf: true, self_mute: false },
    });
    await settle();

    expect(sent).toBe(false);
    expect(events).toEqual([{ type: "disconnected", reason: "failed", error: expect.any(Error) }]);
    expect(leaves(gateway)).toHaveLength(1);
  });

  it("leaves and rejoins the held channel, resolving after connected carries the new token", async () => {
    const gateway = gatewayAdapter();
    const { session, events } = await subscribed(gateway);
    gateway.sendPayload
      .mockImplementationOnce(() => {
        queueMicrotask(() => gateway.state(null));
        return true;
      })
      .mockImplementationOnce(() => {
        queueMicrotask(() => {
          gateway.state(CHANNEL);
          gateway.server("rotated");
        });
        return true;
      });
    let eventsAtResolve: number | undefined;

    await session.rejoin().then(() => {
      eventsAtResolve = events.length;
    });

    expect(gateway.sendPayload.mock.calls.slice(-2).map(([payload]) => payload.d.channel_id)).toEqual([null, CHANNEL]);
    expect(events).toEqual([{ type: "connected", channelId: CHANNEL, gateway: { ...GATEWAY, token: "rotated" } }]);
    expect(eventsAtResolve).toBe(1);
    await session.release();
  });

  it("rejects a rejoin the platform never answers and publishes one disconnect", async () => {
    const gateway = gatewayAdapter();
    const { session, events } = await subscribed(gateway);
    gateway.sendPayload.mockImplementationOnce(() => true).mockImplementationOnce(() => true);

    await expect(session.rejoin()).rejects.toThrow("timed out");

    expect(events).toEqual([{ type: "disconnected", reason: "failed", error: expect.any(Error) }]);
    await expect(session.join(CHANNEL)).rejects.toThrow("released");
  });
});
