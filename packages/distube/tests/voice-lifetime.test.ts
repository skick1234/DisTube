import { describe, expect, it, vi } from "vitest";
import { DisTubeError } from "../src";
import {
  capture,
  deferred,
  FakePlayer,
  FakeSource,
  FakeVoiceSession,
  flushMicrotasks,
  GUILD,
  once,
  playableSetup,
  record,
  settle,
  setup,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };
const SECOND = "second-guild";

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
  it("leave waits for pending session creation and releases the late session once", async () => {
    const harness = playableSetup();
    const creation = harness.adapter.gateCreateSession();
    const joining = capture(harness.distube.voices.join(TARGET));
    await flushMicrotasks(32);

    const leaving = harness.distube.voices.leave(GUILD);
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    creation.resolve(session);

    expect(await joining).toMatchObject({ code: "INVALID_STATE" });
    await leaving;
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
  });

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

  it("leave deletes a provisional first queue while session creation is pending", async () => {
    const harness = playableSetup();
    const creation = harness.adapter.gateCreateSession();
    const play = capture(harness.distube.play(TARGET, "first"));
    await flushMicrotasks(32);

    const leaving = harness.distube.voices.leave(GUILD);
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    creation.resolve(session);

    expect(await play).toMatchObject({ code: "INVALID_STATE" });
    await leaving;
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(session.release).toHaveBeenCalledTimes(1);
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

  it("hides the guild and releases the Player before the session, once, across repeated leave calls", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "first");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    const release = player.gate("release");

    const first = harness.distube.voices.leave(GUILD);
    const second = harness.distube.voices.leave(GUILD);
    expect(second).toBe(first);
    await release.entered;
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(session.release).not.toHaveBeenCalled();
    release.resolve();
    await first;

    expect(player.release).toHaveBeenCalledTimes(1);
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("releases the session after a Player cleanup failure", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    const playing = voice.play({ kind: "url", url: "https://stream.example/clip" });
    await settle();
    harness.engine.player.finish();
    await playing;
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
    const voice = await harness.distube.voices.join(TARGET);
    const playing = voice.play({ kind: "url", url: "https://stream.example/clip" });
    await settle();
    harness.engine.player.finish();
    await playing;
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
