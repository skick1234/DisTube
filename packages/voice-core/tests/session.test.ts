import type { VoiceSessionEvent } from "distube/integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordGatewaySession } from "../src/session";
import { CHANNEL, GATEWAY, gatewayAdapter, native, resetNative, settle } from "./support/native";

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

async function subscribed(
  gateway: ReturnType<typeof gatewayAdapter>,
  timeoutMs = 50,
): Promise<{
  session: DiscordGatewaySession;
  events: VoiceSessionEvent[];
}> {
  const session = await DiscordGatewaySession.connect({ ...options(gateway.creator), timeoutMs });
  const events: VoiceSessionEvent[] = [];
  session.subscribe(event => events.push(event));
  return { session, events };
}

const JOIN_TIMEOUT_MS = 15_000;

function useFakeTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
}

describe("gateway session", () => {
  it("joins without constructing audio and publishes a complete copied snapshot", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordGatewaySession.connect(options(gateway.creator));

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

  it("waits for both halves after a move and republishes refreshed credentials", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordGatewaySession.connect(options(gateway.creator));
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

  it("settles a move whose server update arrives before its state update", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordGatewaySession.connect(options(gateway.creator));
    gateway.sendPayload.mockImplementationOnce(() => {
      queueMicrotask(() => {
        gateway.server("rotated", "new.example");
        gateway.state("other");
      });
      return true;
    });

    await session.join("other");

    expect(session.gateway).toEqual({
      channelId: "other",
      sessionId: GATEWAY.sessionId,
      token: "rotated",
      endpoint: "new.example",
    });
    expect(session.channelId).toBe("other");
    await session.release();
  });

  it("reads the bitrate of the channel it settled in, including after a move", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordGatewaySession.connect(options(gateway.creator));
    const before = session.bitrate;

    await session.join("other");

    expect(before).toBe(64_000);
    expect(session.bitrate).toBe(96_000);
    await session.release();
  });

  it("acknowledges self flags sent through join and stops delivering updates after unsubscribe", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordGatewaySession.connect(options(gateway.creator));
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
    const session = await DiscordGatewaySession.connect(options(gateway.creator));
    gateway.sendPayload.mockImplementationOnce(() => true);

    const moving = session.join("other");
    await session.release();

    await expect(moving).rejects.toThrow("released");
    expect(session.gateway).toBeUndefined();
    expect(gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id === null)).toHaveLength(1);
  });

  it("tries every owned cleanup step and preserves distinct failures", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordGatewaySession.connect(options(gateway.creator));
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
      DiscordGatewaySession.connect(
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
    const session = await DiscordGatewaySession.connect(options(gateway.creator, preflight));
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
    const session = await DiscordGatewaySession.connect(options(gateway.creator));
    gateway.sendPayload.mockReturnValueOnce(false);

    await expect(session.join("other")).rejects.toThrow("Discord gateway is unavailable");
    expect(session.gateway).toEqual(GATEWAY);
    expect(session.channelId).toBe(CHANNEL);
    await session.release();
  });

  it.each([
    ["join", (session: DiscordGatewaySession) => session.join(CHANNEL, { selfMute: true })],
    ["setSelfState", (session: DiscordGatewaySession) => session.setSelfState({ selfMute: true })],
  ])(
    "sends a %s flag write behind an unanswered move only after the move times out, in the channel still held",
    async (_name, write) => {
      const gateway = gatewayAdapter();
      const session = await DiscordGatewaySession.connect(options(gateway.creator));
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

  it("reports a removal while not leaving as a removed disconnect and isolates listener failures", async () => {
    const gateway = gatewayAdapter();
    const session = await DiscordGatewaySession.connect(options(gateway.creator));
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

  it("connects a replacement session that receives the leave echo of the session it replaces", async () => {
    const gateway = gatewayAdapter();
    const previous = await DiscordGatewaySession.connect(options(gateway.creator));
    await previous.release();
    gateway.sendPayload.mockImplementationOnce(() => {
      queueMicrotask(() => {
        gateway.state(null);
        gateway.state(CHANNEL);
        gateway.server();
      });
      return true;
    });

    const session = await DiscordGatewaySession.connect(options(gateway.creator));

    expect(session.gateway).toEqual(GATEWAY);
    expect(leaves(gateway)).toHaveLength(1);
    await session.release();
  });

  it("releases a pending join and rejects ABORTED with the reason as soon as its signal aborts", async () => {
    const gateway = gatewayAdapter();
    gateway.sendPayload.mockImplementationOnce(() => true);
    const controller = new AbortController();
    let failure: unknown;
    const connecting = DiscordGatewaySession.connect({
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
      DiscordGatewaySession.connect({ ...options(gateway.creator), timeoutMs: 60_000, signal: controller.signal }),
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
      DiscordGatewaySession.connect({ ...options(gateway.creator), signal: controller.signal }),
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

      for (const code of [4006, 4009, 4015]) {
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

  it.each([4004, 4011, 4016, 4017, 4021])(
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

  it("leaves before it rejoins on 4006, re-sending each payload the gateway refuses until it accepts", async () => {
    useFakeTimers();
    const gateway = gatewayAdapter();
    const { session, events } = await subscribed(gateway, JOIN_TIMEOUT_MS);
    const before = gateway.sendPayload.mock.calls.length;
    gateway.sendPayload.mockReturnValueOnce(false);

    session.voiceClosed(4006);
    await vi.advanceTimersByTimeAsync(2 * JOIN_TIMEOUT_MS);

    expect(gateway.sendPayload.mock.calls.slice(before).map(([payload]) => payload.d.channel_id)).toEqual([
      null,
      null,
      CHANNEL,
    ]);
    expect(events).toEqual([{ type: "connected", channelId: CHANNEL, gateway: GATEWAY }]);
    await session.release();
  });

  it("publishes one disconnect at the join timeout when the gateway refuses every voiceClosed rejoin", async () => {
    useFakeTimers();
    const gateway = gatewayAdapter();
    const { session, events } = await subscribed(gateway, JOIN_TIMEOUT_MS);
    gateway.sendPayload.mockReturnValue(false);

    session.voiceClosed(4009);
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS - 1);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const attempts = gateway.sendPayload.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4 * JOIN_TIMEOUT_MS);

    expect(events).toEqual([{ type: "disconnected", reason: "failed", error: expect.any(Error) }]);
    expect(gateway.sendPayload).toHaveBeenCalledTimes(attempts);
    expect(session.gateway).toBeUndefined();
  });

  it("sends nothing and publishes nothing on voiceClosed(4014) or voiceClosed(4022), leaving the outcome to the voice state", async () => {
    const gateway = gatewayAdapter();
    const { session, events } = await subscribed(gateway);
    const sent = gateway.sendPayload.mock.calls.length;

    session.voiceClosed(4014);
    session.voiceClosed(4022);
    await settle();

    expect(gateway.sendPayload).toHaveBeenCalledTimes(sent);
    expect(events).toEqual([]);
    gateway.state(null);
    expect(events).toEqual([{ type: "disconnected", reason: "removed" }]);
  });

  it.each([4014, 4022])(
    "keeps the voice past the join timeout when the platform moves the bot after voiceClosed(%i)",
    async code => {
      const gateway = gatewayAdapter();
      const { session, events } = await subscribed(gateway);
      const sent = gateway.sendPayload.mock.calls.length;

      session.voiceClosed(code);
      gateway.state("other");
      gateway.server("moved");
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(gateway.sendPayload).toHaveBeenCalledTimes(sent);
      expect(events).toEqual([
        { type: "connected", channelId: "other", gateway: expect.objectContaining({ token: "moved" }) },
      ]);
    },
  );

  it.each([4014, 4022])("disconnects once at the join timeout when nothing follows voiceClosed(%i)", async code => {
    const gateway = gatewayAdapter();
    const { session, events } = await subscribed(gateway);

    session.voiceClosed(code);
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 500 });
    await settle();

    expect(events).toEqual([
      {
        type: "disconnected",
        reason: "failed",
        error: expect.objectContaining({ message: expect.stringContaining(String(code)) }),
      },
    ]);
    expect(joins(gateway)).toHaveLength(1);
  });

  it("names DAVE without the voice library in the disconnect after voiceClosed(4017)", async () => {
    const gateway = gatewayAdapter();
    const { session, events } = await subscribed(gateway);

    session.voiceClosed(4017);
    await settle();

    const [event] = events;
    expect(events).toHaveLength(1);
    const message = event?.type === "disconnected" && event.reason === "failed" ? event.error.message : "";
    expect(message).toContain("4017");
    expect(message).toContain("DAVE end-to-end encryption");
    expect(message).not.toContain("@discordjs/voice");
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
