import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DisTube, DisTubeError } from "../src";
import type { PlaybackResource } from "../src/integrations";
import {
  capture,
  deferred,
  deletions,
  FakePlayer,
  FakeSource,
  FakeVoiceSession,
  flushMicrotasks,
  GUILD,
  once,
  playableSetup,
  record,
  required,
  settle,
  setup,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };
const SECOND = "second-guild";
const MOVED = { guildId: GUILD, id: "second" };
const IDLE_MS = 1000;

function disconnects(distube: DisTube): string[] {
  const reasons: string[] = [];
  distube.on("voice.disconnected", event => void reasons.push(event.reason));
  return reasons;
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flushMicrotasks(20);
}

describe("voice presence", () => {
  it("outlives the queue it played for and lends the same session and Player to the next one", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    const voice = harness.distube.voices.get(GUILD);
    const player = harness.engine.players[0] as FakePlayer;
    expect(queue.voice).toBe(voice);

    player.finish();
    await settle();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(queue.voice).toBeUndefined();
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    expect(harness.adapter.sessions[0]?.release).not.toHaveBeenCalled();

    const second = await harness.distube.play(TARGET, "b");
    await settle();
    expect(second).not.toBe(queue);
    expect(second.voice).toBe(voice);
    expect(queue.voice).toBeUndefined();
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.engine.players).toEqual([player]);
    expect(player.playing).toBe("b");
  });

  it("joins and leaves without queue events or a Player", async () => {
    const harness = playableSetup();
    const events = record(harness.distube, ["voice.disconnected", "queue.created", "queue.deleted"]);
    const voice = await harness.distube.voices.join(TARGET);
    await voice.leave();
    await settle();
    expect(events).toEqual(["voice.disconnected"]);
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
    expect(harness.adapter.session.release).toHaveBeenCalledTimes(1);
  });

  it("fails the item VOICE_FAILED when the Player closes on its own and plays the next on a new Player at the committed volume", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    await voice.setVolume(60);
    const queue = await harness.distube.play(TARGET, "a");
    await queue.add("b");
    await settle();
    const closed = harness.engine.player;
    const failures: unknown[] = [];
    harness.distube.on("queue.item.failed", event => void failures.push([event.item.song.id, event.error]));
    const failure = new Error("connection destroyed");

    closed.close(failure);
    await settle();

    expect(failures).toMatchObject([["a", { code: "VOICE_FAILED", cause: failure }]]);
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    const replacement = harness.engine.player;
    expect(replacement).not.toBe(closed);
    expect(replacement.volumes).toEqual([60]);
    expect(replacement.playing).toBe("b");
  });

  it("moves an existing DisTubeVoice on join and stays put when it already occupies the channel", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    const session = harness.adapter.sessions[0];

    await harness.distube.voices.join({ guildId: GUILD, id: "other" });
    expect(session?.join).toHaveBeenCalledWith("other");
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe("other");

    await harness.distube.voices.join({ guildId: GUILD, id: "other" });
    expect(session?.join).toHaveBeenCalledTimes(1);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed target before touching the Adapter", async () => {
    const harness = playableSetup();

    await expect(harness.distube.voices.join({ guildId: "", id: "voice" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(
      harness.distube.voices.join({ guildId: GUILD, id: undefined as unknown as string }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();
  });

  it("leaves the guild free when Adapter preflight rejects a public join", async () => {
    const harness = playableSetup();
    const preflightFailure = new DisTubeError("VOICE_FAILED", "@distube/example requires sodium");
    harness.adapter.createVoiceSession.mockRejectedValueOnce(preflightFailure);

    await expect(harness.distube.voices.join(TARGET)).rejects.toBe(preflightFailure);
    expect(harness.distube.voices.size).toBe(0);
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();

    const voice = await harness.distube.voices.join(TARGET);
    expect(voice.guildId).toBe(GUILD);
    expect(harness.distube.voices.size).toBe(1);
  });
});

describe("terminal disconnect", () => {
  it("publishes platform loss as item failure, queue deletion, then one disconnect", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "a");
    await harness.distube.play(TARGET, "b");
    await settle();
    const item = queue.current;
    const order = record(harness.distube, ["queue.item.failed", "queue.deleted", "voice.disconnected"]);
    const itemFailed = vi.fn();
    harness.distube.on("queue.item.failed", itemFailed);
    const deleted = vi.fn();
    harness.distube.on("queue.deleted", event => deleted(event.reason));
    const disconnected = vi.fn();
    harness.distube.on("voice.disconnected", disconnected);

    harness.adapter.sessions[0]?.disconnect(new Error("dropped"));
    await settle();

    expect(order).toEqual(["queue.item.failed", "queue.deleted", "voice.disconnected"]);
    expect(itemFailed).toHaveBeenCalledWith(
      expect.objectContaining({ item, error: expect.objectContaining({ code: "VOICE_FAILED" }) }),
    );
    expect(deleted).toHaveBeenCalledWith("voice-loss");
    expect(harness.engine.player.played).toEqual(["a"]);
    expect(disconnected).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: GUILD,
        reason: "platform",
        error: expect.objectContaining({ code: "VOICE_FAILED" }),
      }),
    );
    expect(harness.distube.voices.size).toBe(0);

    // The DisTubeVoice already ended, so leaving publishes nothing more.
    await harness.distube.voices.leave(GUILD);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it("publishes a disconnect for a DisTubeVoice whose cleanup failed", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    await settle();
    harness.engine.player.release.mockRejectedValue(new Error("cleanup failed"));
    const disconnected = vi.fn();
    harness.distube.on("voice.disconnected", disconnected);

    await expect(harness.distube.voices.leave(GUILD)).rejects.toMatchObject({ code: "VOICE_FAILED" });
    await settle();

    expect(disconnected).toHaveBeenCalledWith(expect.objectContaining({ reason: "left" }));
    expect(harness.adapter.sessions[0]?.release).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.size).toBe(0);
  });
});

describe("shutdown", () => {
  it("releases every connected DisTubeVoice, announces each once, and fences later joins", async () => {
    const harness = playableSetup();
    await harness.distube.voices.join(TARGET);
    await harness.distube.voices.join({ guildId: SECOND, id: VOICE_CHANNEL });
    const reasons: string[] = [];
    harness.distube.on("voice.disconnected", event => reasons.push(`${event.guildId}:${event.reason}`));
    expect(harness.distube.voices.has(GUILD)).toBe(true);
    expect([...harness.distube.voices].map(voice => voice.guildId)).toEqual([GUILD, SECOND]);

    await harness.distube.dispose();

    expect(reasons.toSorted()).toEqual([`${GUILD}:shutdown`, `${SECOND}:shutdown`]);
    expect(harness.adapter.sessions.every(session => session.release.mock.calls.length === 1)).toBe(true);
    expect(harness.distube.voices.size).toBe(0);
    await expect(harness.distube.voices.join(TARGET)).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "DisTube is disposed",
    });
  });
});

describe("deferred DisTubeVoice lifetime", () => {
  it("creates the next session for a guild only after its leaving session is released", async () => {
    const harness = playableSetup();
    await harness.distube.voices.join(TARGET);
    const session = harness.adapter.session;
    const release = session.gateRelease();

    const leaving = harness.distube.voices.leave(GUILD);
    const play = harness.distube.play(TARGET, "fresh");
    await flushMicrotasks(32);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);

    release.resolve();
    await leaving;
    const fresh = await play;
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(2);
    expect(harness.distube.getQueue(GUILD)).toBe(fresh);
    expect(fresh.voice).toBe(harness.distube.voices.get(GUILD));
  });

  it("shutdown waits for a late session release before Plugin disposal", async () => {
    const disposed = vi.fn();
    const plugin = new FakeSource("late-disposal");
    plugin.dispose.mockImplementation(disposed);
    const harness = setup([plugin]);
    const creation = harness.adapter.gateCreateSession();
    const joining = capture(harness.distube.voices.join(TARGET));
    await flushMicrotasks(32);

    const shutdown = harness.distube.dispose();
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    const release = session.gateRelease();
    creation.resolve(session);
    await flushMicrotasks(32);

    expect(session.release).toHaveBeenCalledTimes(1);
    expect(disposed).not.toHaveBeenCalled();
    release.resolve();
    await shutdown;
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(await joining).toMatchObject({ code: "INVALID_STATE" });
  });

  it("releases a created session when DisTubeVoice construction fails", async () => {
    const harness = playableSetup();
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    vi.spyOn(session, "subscribe").mockImplementation(() => {
      throw new Error("subscription failed");
    });
    harness.adapter.createVoiceSession.mockResolvedValueOnce(session);

    await expect(harness.distube.voices.join(TARGET)).rejects.toMatchObject({ code: "VOICE_FAILED" });

    expect(session.release).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
  });

  it("keeps the first terminal reason when leave overlaps platform loss", async () => {
    const harness = playableSetup();
    await harness.distube.voices.join(TARGET);
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    const release = session.gateRelease();
    const reasons: string[] = [];
    harness.distube.on("voice.disconnected", event => reasons.push(event.reason));

    const leaving = harness.distube.voices.leave(GUILD);
    session.disconnect(new Error("late platform loss"));
    release.resolve();
    await leaving;

    expect(reasons).toEqual(["left"]);
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("releases a Player created after leave before releasing its session", async () => {
    const harness = playableSetup();
    const creation = harness.engine.gateCreate();
    const play = await harness.distube.play(TARGET, "first");
    await flushMicrotasks(32);
    const session = harness.adapter.sessions[0] as FakeVoiceSession;

    const leaving = harness.distube.voices.leave(GUILD);
    const player = new FakePlayer();
    const release = player.gate("release");
    creation.resolve(player);
    await release.entered;
    expect(session.release).not.toHaveBeenCalled();
    release.resolve();
    await leaving;

    expect(play.current).toBeUndefined();
    expect(player.played).toEqual([]);
    expect(player.calls).toEqual(["release"]);
  });

  it("leave deletes the queue, hides the guild, releases the Player before the session and announces once", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "first");
    await settle();
    const voice = required(queue.voice);
    const player = harness.engine.player;
    const session = harness.adapter.session;
    const order: string[] = [];
    player.release.mockImplementation(async () => void order.push("player.release"));
    session.release.mockImplementation(async () => void order.push("session.release"));
    harness.distube.on("queue.deleted", event => void order.push(`queue.deleted:${event.reason}`));
    harness.distube.on("voice.disconnected", event => void order.push(`voice.disconnected:${event.reason}`));

    const first = voice.leave();
    const second = harness.distube.voices.leave(GUILD);
    expect(second).toBe(first);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    await first;
    await settle();

    expect(order).toEqual(["queue.deleted:leave", "player.release", "session.release", "voice.disconnected:left"]);
    const successor = await harness.distube.voices.join(TARGET);
    await expect(voice.leave()).resolves.toBeUndefined();
    expect(harness.distube.voices.get(GUILD)).toBe(successor);
    expect(session.release).toHaveBeenCalledTimes(1);
    await expect(voice.setVolume(50)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("releases the session after a Player cleanup failure", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "clip");
    await settle();
    harness.engine.player.finish();
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    const playerFailure = new Error("Player cleanup failed");
    player.release.mockImplementationOnce(() => Promise.reject(playerFailure));

    const failure = (await capture(harness.distube.voices.leave(GUILD))) as Error;

    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.cause).toBe(playerFailure);
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("aggregates Player cleanup before session cleanup failures", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "clip");
    await settle();
    harness.engine.player.finish();
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    const playerFailure = new Error("Player cleanup failed");
    const sessionFailure = new Error("Session cleanup failed");
    player.release.mockImplementationOnce(() => Promise.reject(playerFailure));
    session.release.mockRejectedValueOnce(sessionFailure);

    const failure = (await capture(harness.distube.voices.leave(GUILD))) as Error;

    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors).toEqual([playerFailure, sessionFailure]);
  });

  it("does not let a reentrant failure listener publish queue deletion first", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const queue = await harness.distube.play(TARGET, "first");
    await started.promise;
    const order: string[] = [];
    const disconnected = deferred<void>();
    harness.distube.on("queue.item.failed", () => {
      order.push("failed:first-listener");
      void queue.stop();
    });
    harness.distube.on("queue.item.failed", () => order.push("failed:second-listener"));
    harness.distube.on("queue.deleted", () => order.push("deleted"));
    once(harness.distube, "voice.disconnected", () => {
      order.push("disconnected");
      disconnected.resolve();
    });

    harness.adapter.sessions[0]?.disconnect(new Error("connection lost"));
    await disconnected.promise;

    expect(order).toEqual(["failed:first-listener", "failed:second-listener", "deleted", "disconnected"]);
  });

  it.each(["Player first", "session first"] as const)(
    "publishes one terminal item event when %s callbacks race",
    async order => {
      const harness = playableSetup();
      const started = deferred<void>();
      once(harness.distube, "queue.item.started", () => started.resolve());
      await harness.distube.play(TARGET, "first");
      await started.promise;
      const player = harness.engine.players[0] as FakePlayer;
      const failures = vi.fn();
      const disconnected = deferred<void>();
      harness.distube.on("queue.item.failed", failures);
      once(harness.distube, "voice.disconnected", () => disconnected.resolve());

      if (order === "Player first") {
        player.fail(new Error("decoder lost"));
        harness.adapter.sessions[0]?.disconnect(new Error("gateway lost"));
      } else {
        harness.adapter.sessions[0]?.disconnect(new Error("gateway lost"));
        player.fail(new Error("decoder lost"));
      }
      await disconnected.promise;

      expect(failures).toHaveBeenCalledTimes(1);
      expect(harness.distube.voices.has(GUILD)).toBe(false);
    },
  );

  it("applies pause and resume in invocation order", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const queue = await harness.distube.play(TARGET, "first");
    await started.promise;
    const pauseGate = player.gate("pause");

    const pausing = queue.pause();
    await pauseGate.entered;
    const resuming = queue.resume();
    expect(player.resume).not.toHaveBeenCalled();

    pauseGate.resolve();
    await pausing;
    await resuming;
    expect(player.calls).toEqual(["volume:100", "play:first", "pause", "resume"]);
    expect(queue.status).toBe("playing");
  });

  it("folds unawaited filter changes in invocation order", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "first");
    await settle();
    const voice = harness.distube.voices.get(GUILD);
    if (!voice) throw new Error("DisTubeVoice missing");

    const first = voice.filters.set("bassboost");
    const second = voice.filters.set("nightcore");
    await Promise.all([first, second]);

    expect(voice.filters.names).toEqual(["bassboost", "nightcore"]);

    const removed = voice.filters.clear();
    const reapplied = voice.filters.set("bassboost");
    const cleared = voice.filters.clear();
    await Promise.all([removed, reapplied, cleared]);

    expect(voice.filters.names).toEqual([]);
  });

  it("keeps the last committed DisTubeVoice channel when Adapter movement rejects", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    session.join.mockImplementationOnce(async channelId => {
      session.channelId = channelId;
      throw new Error("gateway move rejected");
    });

    await expect(voice.move({ guildId: GUILD, id: "other" })).rejects.toMatchObject({ code: "VOICE_FAILED" });

    expect(voice.channelId).toBe(VOICE_CHANNEL);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(VOICE_CHANNEL);
  });

  it("keeps a replacement queue's track playing after the old queue's stop", async () => {
    const harness = playableSetup();
    const first = await harness.distube.play(TARGET, "first");
    await settle();

    const stopping = first.stop();
    const second = await harness.distube.play(TARGET, "second");
    await stopping;
    await settle();

    expect(second).not.toBe(first);
    expect(harness.engine.player.played).toEqual(["first", "second"]);
    expect(harness.engine.player.playing).toBe("second");
    expect(second.current?.song.id).toBe("second");
  });

  it("follows an externally moved session without disturbing the queue or the active track", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const queue = await harness.distube.play(TARGET, "playing");
    const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
    await started.promise;
    const player = harness.engine.players[0] as FakePlayer;
    const outcomes = record(harness.distube, ["queue.item.finished", "queue.item.failed", "queue.deleted"]);

    // The Adapter republishes `connected` for a channel nobody asked us to join.
    (harness.adapter.sessions[0] as FakeVoiceSession).connect(
      { channelId: "dragged", sessionId: "session", token: "token", endpoint: "endpoint" },
      "dragged",
    );
    await settle();

    expect(harness.distube.voices.get(GUILD)?.channelId).toBe("dragged");
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(queue.current?.id).toBe(items[0]?.id);
    expect(player.playing).toBe("playing");
    expect(player.stopTrack).not.toHaveBeenCalled();
    expect(player.updateVoiceGateway).toHaveBeenCalledWith(expect.objectContaining({ channelId: "dragged" }));
    expect(outcomes).toEqual([]);
  });
});

describe("idle voice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves a voices.join with no play after idleTimeoutMs, releasing its session", async () => {
    const harness = playableSetup("source", { idleTimeoutMs: IDLE_MS });
    const left = disconnects(harness.distube);
    await harness.distube.voices.join(TARGET);
    const session = harness.adapter.session;

    await advance(IDLE_MS - 1);
    expect(left).toEqual([]);
    await advance(1);

    expect(left).toEqual(["idle"]);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "a queue that finishes",
      async (harness: ReturnType<typeof playableSetup<undefined>>) => {
        await harness.distube.play(TARGET, "a");
        await flushMicrotasks(30);
        harness.engine.player.finish();
      },
      ["finished"],
    ],
    [
      "a first play whose step fails after the join",
      async (harness: ReturnType<typeof playableSetup<undefined>>) => {
        const controller = new AbortController();
        const gate = harness.adapter.gateCreateSession();
        const playing = capture(harness.distube.play(TARGET, "a", { signal: controller.signal }));
        await flushMicrotasks(30);
        controller.abort();
        gate.resolve(new FakeVoiceSession(GUILD, VOICE_CHANNEL));
        expect(await playing).toMatchObject({ code: "ABORTED" });
        expect(harness.distube.voices.has(GUILD)).toBe(true);
      },
      ["failed"],
    ],
    [
      "clear during the first preparation",
      async (harness: ReturnType<typeof playableSetup<undefined>>) => {
        const held = deferred<PlaybackResource>();
        harness.source.stream.mockImplementationOnce(() => held.promise);
        const queue = await harness.distube.play(TARGET, "a");
        await flushMicrotasks(30);
        queue.clear();
        held.resolve(harness.source.resource("a"));
      },
      ["finished"],
    ],
  ])("leaves on idle after %s", async (_name, reach, deleted) => {
    const harness = playableSetup("source", { idleTimeoutMs: IDLE_MS });
    const reasons = deletions(harness.distube);
    const left = disconnects(harness.distube);

    await reach(harness);
    await flushMicrotasks(30);
    expect(reasons).toEqual(deleted);
    expect(harness.distube.voices.has(GUILD)).toBe(true);

    await advance(IDLE_MS - 1);
    expect(left).toEqual([]);
    await advance(1);
    expect(left).toEqual(["idle"]);
  });

  it("restarts the timer from a queue's deletion when a play came before the deadline", async () => {
    const harness = playableSetup("source", { idleTimeoutMs: IDLE_MS });
    const left = disconnects(harness.distube);
    const voice = await harness.distube.voices.join(TARGET);
    await advance(600);
    const held = deferred<never>();
    harness.source.search.mockImplementationOnce(() => held.promise);
    const playing = capture(harness.distube.play(TARGET, "a"));
    const queue = harness.distube.getQueue(GUILD);
    await advance(600);
    expect(left).toEqual([]);

    await queue?.stop();
    await advance(IDLE_MS - 1);
    expect(left).toEqual([]);
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    await advance(1);
    expect(left).toEqual(["idle"]);
    held.reject(new Error("late"));
    expect(await playing).toMatchObject({ code: "INVALID_STATE" });
  });

  it("stops a queue pending its first step with reason stop, keeps the voice and arms the timer", async () => {
    const harness = playableSetup("source", { idleTimeoutMs: IDLE_MS });
    const reasons = deletions(harness.distube);
    const left = disconnects(harness.distube);
    const voice = await harness.distube.voices.join(TARGET);
    const held = deferred<never>();
    harness.source.search.mockImplementationOnce(() => held.promise);
    const playing = capture(harness.distube.play(TARGET, "a"));
    await flushMicrotasks(30);

    await harness.distube.getQueue(GUILD)?.stop();
    await flushMicrotasks(30);
    expect(reasons).toEqual(["stop"]);
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    await advance(IDLE_MS);
    expect(left).toEqual(["idle"]);
    held.reject(new Error("late"));
    expect(await playing).toMatchObject({ code: "INVALID_STATE" });
  });

  it("stops a queue resolving its first input before any join with reason stop and never joins", async () => {
    const harness = playableSetup();
    const reasons = deletions(harness.distube);
    const held = deferred<never>();
    harness.source.search.mockImplementationOnce(() => held.promise);
    const playing = capture(harness.distube.play(TARGET, "a"));
    await flushMicrotasks(30);

    await harness.distube.getQueue(GUILD)?.stop();
    held.reject(new Error("late"));
    expect(await playing).toMatchObject({ code: "INVALID_STATE" });
    expect(reasons).toEqual(["stop"]);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();
  });

  it("holds the timer while a paused queue exists and arms it when the queue is deleted", async () => {
    const harness = playableSetup("source", { idleTimeoutMs: IDLE_MS });
    const left = disconnects(harness.distube);
    const queue = await harness.distube.play(TARGET, "a");
    await flushMicrotasks(30);
    await queue.pause();
    await advance(IDLE_MS * 5);
    expect(left).toEqual([]);
    expect(queue.status).toBe("paused");

    await queue.stop();
    await advance(IDLE_MS - 1);
    expect(left).toEqual([]);
    await advance(1);
    expect(left).toEqual(["idle"]);
  });

  it("does not restart a running timer when voices.join moves the idle voice", async () => {
    const harness = playableSetup("source", { idleTimeoutMs: IDLE_MS });
    const left = disconnects(harness.distube);
    await harness.distube.voices.join(TARGET);
    await advance(600);
    const voice = await harness.distube.voices.join({ guildId: GUILD, id: "second" });
    expect(voice.channelId).toBe("second");

    await advance(400);
    expect(left).toEqual(["idle"]);
  });

  it("never leaves with idleTimeoutMs 0", async () => {
    const harness = playableSetup("source", { idleTimeoutMs: 0 });
    const left = disconnects(harness.distube);
    await harness.distube.voices.join(TARGET);
    await advance(300_000 * 10);
    expect(left).toEqual([]);
    expect(harness.distube.voices.has(GUILD)).toBe(true);
  });

  it("clears the timer on dispose", async () => {
    const harness = playableSetup("source", { idleTimeoutMs: IDLE_MS });
    const left = disconnects(harness.distube);
    await harness.distube.voices.join(TARGET);
    expect(vi.getTimerCount()).toBe(1);

    await harness.distube.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await advance(IDLE_MS);
    expect(left).toEqual(["shutdown"]);
  });
});

describe("leave during a pending join", () => {
  it.each([
    ["voices.join", "voices.leave", []],
    ["distube.play", "voices.leave", ["leave"]],
    ["distube.play", "queue.stop", ["leave"]],
  ] as const)(
    "%s then %s during session creation releases the late session once and settles after that release",
    async (start, end, deleted) => {
      const harness = playableSetup();
      const reasons = deletions(harness.distube);
      const creation = harness.adapter.gateCreateSession();
      const joining = capture<unknown>(
        start === "voices.join" ? harness.distube.voices.join(TARGET) : harness.distube.play(TARGET, "a"),
      );
      await settle();
      expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
      const queue = harness.distube.getQueue(GUILD);
      const ending = (): Promise<void> =>
        end === "queue.stop" ? required(queue).stop() : harness.distube.voices.leave(GUILD);

      const late = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
      const release = late.gateRelease();
      const ended = ending();
      expect(ending()).toBe(ended);
      let settled = false;
      void ended.then(() => (settled = true));
      creation.resolve(late);
      await settle();
      expect(late.release).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      release.resolve();
      await ended;
      expect(await joining).toMatchObject({ code: "INVALID_STATE" });
      expect(reasons).toEqual(deleted);
      expect(harness.distube.getQueue(GUILD)).toBeUndefined();
      expect(harness.distube.voices.has(GUILD)).toBe(false);
      expect(late.release).toHaveBeenCalledTimes(1);
    },
  );

  it("voices.leave waits for the late session's release before the next play creates a session", async () => {
    const harness = playableSetup();
    const gate = harness.adapter.gateCreateSession();
    const joining = capture(harness.distube.voices.join(TARGET));
    await settle();
    const late = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    const release = late.gateRelease();
    let left = false;
    const leaving = harness.distube.voices.leave(GUILD).then(() => (left = true));
    gate.resolve(late);
    const next = harness.distube.play(TARGET, "a");
    await settle();
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(left).toBe(false);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);

    release.resolve();
    await leaving;
    await next;
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(2);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(VOICE_CHANNEL);
    expect(harness.adapter.session).not.toBe(late);
    expect(await joining).toMatchObject({ code: "INVALID_STATE" });
  });

  it.each([
    ["voices.join", "voices.leave", []],
    ["distube.play", "voices.leave", ["leave"]],
    ["distube.play", "queue.stop", ["leave"]],
    ["voices.join", "dispose", []],
  ] as const)(
    "%s then %s aborts the pending creation, resolves once the adapter rejects and drops the adapter's error",
    async (start, end, deleted) => {
      const harness = playableSetup();
      const reasons = deletions(harness.distube);
      const adapterError = new Error("adapter saw the abort");
      const asked = deferred<void>();
      harness.adapter.createVoiceSession.mockImplementationOnce(
        (_target, options) =>
          new Promise<never>((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(adapterError), { once: true });
            asked.resolve();
          }),
      );
      const joining: Promise<unknown> =
        start === "voices.join"
          ? capture(harness.distube.voices.join(TARGET))
          : capture(harness.distube.play(TARGET, "a"));
      await asked.promise;

      if (end === "queue.stop") await required(harness.distube.getQueue(GUILD)).stop();
      else if (end === "dispose") await harness.distube.dispose();
      else await harness.distube.voices.leave(GUILD);

      const failure = await joining;
      expect(failure).toMatchObject({ code: "INVALID_STATE" });
      const causes: unknown[] = [];
      for (let error: unknown = failure; error instanceof Error; error = error.cause) causes.push(error);
      expect(causes).not.toContain(adapterError);
      expect(harness.distube.voices.has(GUILD)).toBe(false);
      expect(reasons).toEqual(deleted);
    },
  );

  it("never asks the adapter for a join that a leave superseded while it waited on the previous release", async () => {
    const harness = playableSetup();
    await harness.distube.voices.join(TARGET);
    const release = harness.adapter.session.gateRelease();
    const leaving = harness.distube.voices.leave(GUILD);
    const joining = capture(harness.distube.voices.join(TARGET));
    await settle();
    const superseding = harness.distube.voices.leave(GUILD);
    release.resolve();
    await Promise.all([leaving, superseding]);

    expect(await joining).toMatchObject({ code: "INVALID_STATE" });
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
  });

  it("keeps the replacement creation shared when the superseded one settles late", async () => {
    const harness = playableSetup();
    const superseded = harness.adapter.gateCreateSession();
    const replacement = harness.adapter.gateCreateSession();
    const first = capture(harness.distube.voices.join(TARGET));
    await settle();
    const leaving = harness.distube.voices.leave(GUILD);
    const second = harness.distube.voices.join(TARGET);
    superseded.resolve(new FakeVoiceSession(GUILD, VOICE_CHANNEL));
    await leaving;
    await settle();
    const third = harness.distube.voices.join(TARGET);
    replacement.resolve(new FakeVoiceSession(GUILD, VOICE_CHANNEL));

    expect(await third).toBe(await second);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(2);
    expect(await first).toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("channel ordering", () => {
  it("runs overlapping moves in call order and ends in the later target", async () => {
    const harness = setup([]);
    const voice = await harness.distube.voices.join(TARGET);
    const session = harness.adapter.session;
    const ack = session.gateJoin();

    const first = voice.move(MOVED);
    const second = voice.move({ guildId: GUILD, id: "third" });
    await settle();
    expect(session.join.mock.calls).toEqual([["second"]]);

    ack.resolve();
    await Promise.all([first, second]);
    expect(session.join.mock.calls).toEqual([["second"], ["third"]]);
    expect(voice.channelId).toBe("third");
  });

  it("ends in the replacement queue's channel when a stopped queue's play was still moving", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    const session = harness.adapter.session;
    const ack = session.gateJoin();
    const moving = capture(harness.distube.play(MOVED, "b"));
    await settle();
    expect(session.join.mock.calls).toEqual([["second"]]);

    await queue.stop();
    const replacement = harness.distube.play(TARGET, "c");
    await settle();
    ack.resolve();

    expect(await moving).toMatchObject({ code: "INVALID_STATE" });
    expect(await replacement).toBe(harness.distube.getQueue(GUILD));
    expect(session.join.mock.calls).toEqual([["second"], ["voice"]]);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(VOICE_CHANNEL);
  });
});
