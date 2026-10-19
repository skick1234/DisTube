import { describe, expect, it, vi } from "vitest";
import { DisTubeError, type Song } from "../src";
import {
  capture,
  deferred,
  FakePlayer,
  FakeSource,
  FakeVoiceSession,
  flushMicrotasks,
  GUILD,
  media,
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
    const secondItems = [...(second.current ? [second.current] : []), ...second.upcoming];
    await settle();
    expect(second).not.toBe(queue);
    expect(second.voice).toBe(voice);
    expect(queue.voice).toBeUndefined();
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.engine.players).toEqual([player]);
    expect(player.playing).toBe(secondItems[0]?.id);
  });

  it("releases an idle terminal Player before the next playback starts", async () => {
    const harness = playableSetup();
    const first = await harness.distube.play(TARGET, "a");
    const firstItems = [...(first.current ? [first.current] : []), ...first.upcoming];
    await settle();
    const player = harness.engine.players[0] as FakePlayer;

    player.finish();
    await settle();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();

    const events = record(harness.distube, ["voice.track.failed", "queue.item.failed", "queue.deleted"]);
    player.emit({ type: "terminal", error: new Error("backend lost between tracks") });
    await settle();

    expect(events).toEqual([]);
    expect(player.release).toHaveBeenCalledTimes(1);

    const second = await harness.distube.play(TARGET, "b");
    const secondItems = [...(second.current ? [second.current] : []), ...second.upcoming];
    await settle();
    const successor = harness.engine.players[1] as FakePlayer;

    expect(harness.engine.players).toHaveLength(2);
    expect(player.requests.map(request => request.itemId)).toEqual([firstItems[0]?.id]);
    expect(successor.requests.map(request => request.itemId)).toEqual([secondItems[0]?.id]);
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
  it("publishes platform loss as track failure, item failure, queue deletion, then one disconnect", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    const itemId = queue.current?.id;
    const order = record(harness.distube, [
      "voice.track.failed",
      "queue.item.failed",
      "queue.deleted",
      "voice.disconnected",
    ]);
    const trackFailed = vi.fn();
    harness.distube.on("voice.track.failed", trackFailed);
    const disconnected = vi.fn();
    harness.distube.on("voice.disconnected", disconnected);

    harness.adapter.sessions[0]?.disconnect(new Error("dropped"));
    await settle();

    expect(order).toEqual(["voice.track.failed", "queue.item.failed", "queue.deleted", "voice.disconnected"]);
    expect(itemId).toBeDefined();
    expect(trackFailed).toHaveBeenCalledWith(
      expect.objectContaining({ itemId, error: expect.objectContaining({ code: "VOICE_FAILED" }) }),
    );
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

  it("publishes a disconnect for a DisTubeVoice whose queue deletion failed", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    await settle();
    (harness.engine.players[0] as FakePlayer).stopTrack.mockRejectedValue(new Error("cleanup failed"));
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

  it("rejects play accepted while leave holds the guild DisTubeVoice terminal fence", async () => {
    const harness = playableSetup();
    await harness.distube.voices.join(TARGET);
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    const release = session.gateRelease();

    const leaving = harness.distube.voices.leave(GUILD);
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const play = capture(harness.distube.play(TARGET, "rejected"));
    await flushMicrotasks(32);

    release.resolve();
    await leaving;
    resolution.resolve(media("source", "rejected"));

    expect(await play).toMatchObject({ code: "INVALID_STATE" });
    expect(harness.source.resolve).not.toHaveBeenCalled();

    const fresh = await harness.distube.play(TARGET, "fresh");
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(2);
    expect(harness.distube.getQueue(GUILD)).toBe(fresh);
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
    const harness = setup([], { sources: [plugin] });
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

  it("joins failed DisTubeVoice construction cleanup before shutdown disposes Plugins", async () => {
    const disposed = vi.fn();
    const plugin = new FakeSource("construction-cleanup");
    plugin.dispose.mockImplementation(disposed);
    const harness = setup([], { sources: [plugin] });
    const creation = harness.adapter.gateCreateSession();
    const joining = capture(harness.distube.voices.join(TARGET));
    await flushMicrotasks(32);

    const shutdown = harness.distube.dispose();
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    vi.spyOn(session, "subscribe").mockImplementation(() => {
      throw new Error("subscription failed");
    });
    const release = session.gateRelease();
    creation.resolve(session);
    await flushMicrotasks(32);

    expect(session.release).toHaveBeenCalledTimes(1);
    expect(disposed).not.toHaveBeenCalled();

    release.resolve();
    await shutdown;
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(await joining).toMatchObject({ code: "VOICE_FAILED" });
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

  it("serializes public DisTubeVoice movement and waits for accepted movement before leave", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    const move = deferred<void>();
    session.join.mockImplementationOnce(async channelId => {
      await move.promise;
      session.channelId = channelId;
    });

    const moving = voice.move({ guildId: GUILD, id: "other" });
    await flushMicrotasks(32);
    const leaving = harness.distube.voices.leave(GUILD);
    await flushMicrotasks(32);
    expect(session.release).not.toHaveBeenCalled();

    move.resolve();
    await moving;
    await leaving;
    expect(session.channelId).toBe("other");
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
    expect(player.requests).toEqual([]);
    expect(player.calls).toEqual(["release"]);
    expect(player.listeners.size).toBe(0);
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
    await voice.play({ kind: "url", url: "https://stream.example/clip", dispose: () => undefined });
    (harness.engine.players[0] as FakePlayer).finish();
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
    const voice = await harness.distube.voices.join(TARGET);
    await voice.play({ kind: "url", url: "https://stream.example/clip", dispose: () => undefined });
    (harness.engine.players[0] as FakePlayer).finish();
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

  it("drops late Player outcomes after terminal release begins", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "first");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const release = player.gate("release");
    const events = record(harness.distube, ["voice.track.failed", "queue.item.finished", "queue.item.failed"]);

    const leaving = harness.distube.voices.leave(GUILD);
    await release.entered;
    player.emit({ type: "failed", itemId: "first", error: new Error("late"), terminal: true });
    release.resolve();
    await leaving;

    expect(events).toEqual([]);
  });

  it("commits an outcome received while its Player activation is still settling", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    player.play.mockImplementationOnce(async request => {
      player.requests.push(request);
      player.emit({ type: "failed", itemId: request.itemId, error: new Error("decoder lost"), terminal: true });
    });
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    const events = record(harness.distube, [
      "voice.track.started",
      "voice.track.failed",
      "queue.item.started",
      "queue.item.failed",
      "queue.deleted",
    ]);
    const deleted = deferred<void>();
    once(harness.distube, "queue.deleted", () => deleted.resolve());

    const queue = await harness.distube.play(TARGET, "first");
    await deleted.promise;

    expect(events).toEqual([
      "voice.track.started",
      "queue.item.started",
      "voice.track.failed",
      "queue.item.failed",
      "queue.deleted",
    ]);
    expect(queue.current).toBeUndefined();
  });

  it("retires a terminal Player and creates a fresh one for the next queue", async () => {
    const harness = playableSetup();
    const firstStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => firstStarted.resolve());
    const first = await harness.distube.play(TARGET, "first");
    const firstItems = [...(first.current ? [first.current] : []), ...first.upcoming];
    await firstStarted.promise;
    const firstPlayer = harness.engine.players[0] as FakePlayer;

    firstPlayer.emit({
      type: "failed",
      itemId: firstPlayer.playing as string,
      error: new Error("decoder lost"),
      terminal: true,
    });
    await first.stop();

    const secondStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => secondStarted.resolve());
    const second = await harness.distube.play(TARGET, "second");
    const secondItems = [...(second.current ? [second.current] : []), ...second.upcoming];
    await secondStarted.promise;

    expect(harness.engine.createPlayer).toHaveBeenCalledTimes(2);
    expect(firstPlayer.release).toHaveBeenCalledTimes(1);
    expect(firstPlayer.requests.map(request => request.itemId)).toEqual([firstItems[0]?.id]);
    expect((harness.engine.players[1] as FakePlayer).requests.map(request => request.itemId)).toEqual([
      secondItems[0]?.id,
    ]);
  });

  it("fails the active item when a stale terminal outcome retires its Player", async () => {
    const harness = playableSetup();
    const first = await harness.distube.play(TARGET, "first");
    const firstItems = [...(first.current ? [first.current] : []), ...first.upcoming];
    const second = await harness.distube.play(TARGET, "second");
    const secondItem = required(second.upcoming.at(-1)).id;
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const firstItem = firstItems[0]?.id as string;

    player.emit({ type: "finished", itemId: firstItem });
    await settle();
    expect(first.current?.id).toBe(secondItem);
    const events = record(harness.distube, ["voice.track.failed", "queue.item.failed", "queue.deleted"]);
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", failed);

    // A terminal report naming an item that already ended still means the backend is gone: the current
    // item cannot continue on it, so it fails with the backend's cause instead of hanging as "playing".
    const cause = new Error("late decoder loss");
    player.emit({ type: "failed", itemId: player.requestIds[0] as string, error: cause, terminal: true });
    await settle();

    expect(player.release).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["voice.track.failed", "queue.item.failed", "queue.deleted"]);
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ id: secondItem }),
        error: expect.objectContaining({ code: "VOICE_FAILED", cause }),
      }),
    );
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.has(GUILD)).toBe(true);
  });

  it("retains a retired Player failure for a later DisTubeVoice release", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "first");
    const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    const releaseFailure = new Error("retired Player cleanup failed");
    player.release.mockImplementationOnce(() => Promise.reject(releaseFailure));

    player.emit({ type: "failed", itemId: items[0]?.id as string, error: new Error("decoder lost"), terminal: true });
    await settle();

    const failure = (await capture(harness.distube.voices.leave(GUILD))) as Error;
    expect(failure).toMatchObject({ code: "VOICE_FAILED", cause: releaseFailure });
    expect(session.release).toHaveBeenCalledTimes(1);
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
      const itemId = player.playing as string;
      const failures = vi.fn();
      const disconnected = deferred<void>();
      harness.distube.on("queue.item.failed", failures);
      once(harness.distube, "voice.disconnected", () => disconnected.resolve());

      if (order === "Player first") {
        player.emit({ type: "failed", itemId, error: new Error("decoder lost"), terminal: true });
        harness.adapter.sessions[0]?.disconnect(new Error("gateway lost"));
      } else {
        harness.adapter.sessions[0]?.disconnect(new Error("gateway lost"));
        player.emit({ type: "failed", itemId, error: new Error("decoder lost"), terminal: true });
      }
      await disconnected.promise;

      expect(failures).toHaveBeenCalledTimes(1);
      expect(harness.distube.voices.has(GUILD)).toBe(false);
    },
  );

  it("serializes Player effects through the DisTubeVoice lane", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const queue = await harness.distube.play(TARGET, "first");
    const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
    await started.promise;
    const pauseGate = player.gate("pause");

    const pausing = queue.pause();
    await pauseGate.entered;
    const resuming = queue.resume();
    expect(player.resume).not.toHaveBeenCalled();

    pauseGate.resolve();
    await pausing;
    await resuming;
    expect(player.calls).toEqual(["volume:100", `play:${items[0]?.id}`, "pause", "resume"]);
  });

  it("serializes a filter commit behind the play effect it shares the Player lane with", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    // Held from before the Player exists, so the play effect still occupies the lane when the commit lands.
    const playGate = player.gate("play");
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    await harness.distube.play(TARGET, "first");
    await playGate.entered;

    const applying = harness.distube.voices.get(GUILD)?.filters.set("bassboost");
    await flushMicrotasks(32);
    expect(player.renders).toEqual([]);

    playGate.resolve();
    await started.promise;
    await applying;
    await flushMicrotasks(32);

    expect(harness.distube.voices.get(GUILD)?.filters.names).toEqual(["bassboost"]);
    expect(player.renders).toEqual([[{ name: "bassboost", value: 10 }]]);
    expect(player.calls.indexOf("filters")).toBeGreaterThan(player.calls.indexOf("play"));
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

  it("commits queued DisTubeVoice settings when a Player retires before they run", async () => {
    const harness = playableSetup();
    const first = await harness.distube.play(TARGET, "first");
    const firstItems = [...(first.current ? [first.current] : []), ...first.upcoming];
    await settle();
    const voice = harness.distube.voices.get(GUILD);
    if (!voice) throw new Error("DisTubeVoice missing");
    const player = harness.engine.players[0] as FakePlayer;
    const pause = player.gate("pause");

    const pausing = capture(first.pause());
    await pause.entered;
    const volume = voice.setVolume(42);
    const filters = voice.filters.set("nightcore");

    player.emit({
      type: "failed",
      itemId: firstItems[0]?.id as string,
      error: new Error("Player retired"),
      terminal: true,
    });
    pause.resolve();
    await Promise.all([volume, filters]);
    await pausing;
    await settle();

    expect(voice.volume).toBe(42);
    expect(voice.filters.names).toEqual(["nightcore"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();

    await harness.distube.play(TARGET, "second");
    await settle();
    const successor = harness.engine.players[1] as FakePlayer;

    expect(successor.volumes).toEqual([42]);
    expect(successor.renders).toEqual([[{ name: "nightcore" }]]);
  });

  it("delivers successor Player outcomes to the attached queue", async () => {
    const harness = playableSetup();
    const first = await harness.distube.play(TARGET, "first");
    const firstItems = [...(first.current ? [first.current] : []), ...first.upcoming];
    await first.add("second");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;

    player.emit({
      type: "failed",
      itemId: firstItems[0]?.id as string,
      error: new Error("Player retired"),
      terminal: true,
    });
    await settle();

    const successor = harness.engine.players[1] as FakePlayer;
    expect(first.current?.song.id).toBe("second");
    const events = record(harness.distube, ["queue.item.finished", "queue.finished", "queue.deleted"]);

    successor.finish();
    await settle();

    expect(events).toEqual(["queue.item.finished", "queue.finished", "queue.deleted"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("restores committed settings onto a replacement Player once, before its first track", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const first = await harness.distube.play(TARGET, "first");
    await started.promise;
    const voice = harness.distube.voices.get(GUILD);
    await voice?.setVolume(40);
    await voice?.filters.set("nightcore");

    const firstPlayer = harness.engine.players[0] as FakePlayer;
    firstPlayer.emit({
      type: "failed",
      itemId: firstPlayer.playing as string,
      error: new Error("device lost"),
      terminal: true,
    });
    await settle();

    // A terminal failure deletes the exhausted queue; the next play needs the replacement Player.
    expect(first.current).toBeUndefined();
    const secondStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => secondStarted.resolve());
    await harness.distube.play(TARGET, "second");
    await secondStarted.promise;
    const replacement = harness.engine.players[1] as FakePlayer;

    // One restore per Player, not one per queue or per track.
    expect(replacement.volumes).toEqual([40]);
    expect(replacement.renders).toEqual([[{ name: "nightcore" }]]);
    expect(replacement.calls.slice(0, 3)).toEqual(["volume:40", "filters", expect.stringMatching(/^play:/)]);
    expect(firstPlayer.volumes).toEqual([100, 40]);
    expect(firstPlayer.renders).toEqual([[{ name: "nightcore" }]]);
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

  it("keeps a replacement queue behind the old queue's track stop", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    const firstStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => firstStarted.resolve());
    const first = await harness.distube.play(TARGET, "first");
    const firstItems = [...(first.current ? [first.current] : []), ...first.upcoming];
    await firstStarted.promise;
    const stop = player.gate("stop");

    const stopping = first.stop();
    await stop.entered;
    const secondStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => secondStarted.resolve());
    const replacement = harness.distube.play(TARGET, "second");
    await flushMicrotasks(32);
    expect(harness.distube.getQueue(GUILD)).not.toBe(first);
    expect(player.requests.map(request => request.itemId)).toEqual([firstItems[0]?.id]);
    stop.resolve();
    await stopping;
    const second = await replacement;
    const secondItems = [...(second.current ? [second.current] : []), ...second.upcoming];
    await secondStarted.promise;
    expect(player.requests.map(request => request.itemId)).toEqual([firstItems[0]?.id, secondItems[0]?.id]);
  });

  it("rejects a control whose item ended while it waited in the DisTubeVoice lane", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const queue = await harness.distube.play(TARGET, "first");
    const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
    await started.promise;
    const gateway = player.gate("gateway");
    const deleted = deferred<void>();
    once(harness.distube, "queue.deleted", () => deleted.resolve());

    (harness.adapter.sessions[0] as FakeVoiceSession).connect({
      channelId: VOICE_CHANNEL,
      sessionId: "session",
      token: "token",
      endpoint: "endpoint",
    });
    await gateway.entered;
    player.emit({ type: "finished", itemId: items[0]?.id as string });
    const paused = capture(queue.pause());
    gateway.resolve();

    expect(await paused).toMatchObject({ code: "INVALID_STATE" });
    await deleted.promise;
    expect(player.pause).not.toHaveBeenCalled();
  });

  it("follows an externally moved session without disturbing the queue or the active track", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const queue = await harness.distube.play(TARGET, "playing");
    const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
    await started.promise;
    const player = harness.engine.players[0] as FakePlayer;
    const outcomes = record(harness.distube, [
      "voice.track.finished",
      "voice.track.failed",
      "queue.item.finished",
      "queue.item.failed",
      "queue.deleted",
    ]);

    // The Adapter republishes `connected` for a channel nobody asked us to join.
    (harness.adapter.sessions[0] as FakeVoiceSession).connect(
      { channelId: "dragged", sessionId: "session", token: "token", endpoint: "endpoint" },
      "dragged",
    );
    await settle();

    expect(harness.distube.voices.get(GUILD)?.channelId).toBe("dragged");
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(queue.current?.id).toBe(items[0]?.id);
    expect(player.playing).toBe(items[0]?.id);
    expect(player.stopTrack).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });
});
