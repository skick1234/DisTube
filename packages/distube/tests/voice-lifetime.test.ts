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
  mediaUrl,
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
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const voice = harness.distube.voices.get(GUILD);
    const player = harness.engine.players[0] as FakePlayer;

    (harness.engine.players[0] as FakePlayer).finish();
    await settle();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    expect(harness.adapter.sessions[0]?.release).not.toHaveBeenCalled();

    const second = await harness.distube.play(TARGET, "b");
    await settle();
    expect(second.queue).not.toBe(queue);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.engine.players).toEqual([player]);
    expect(player.playing).toBe(second.items[0]?.id);
  });

  it("passes the session client identity to the Engine", async () => {
    const harness = playableSetup();

    await harness.distube.play(TARGET, "a");
    await settle();

    expect(harness.engine.createPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: GUILD, clientUserId: "bot" }),
    );
  });

  it("releases an idle terminal Player before the next playback starts", async () => {
    const harness = playableSetup();
    const first = await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;

    player.finish();
    await settle();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();

    const events = record(harness.distube, ["queue.item.failed", "queue.deleted"]);
    player.emit({ type: "terminal", error: new Error("backend lost between tracks") });
    await settle();

    expect(events).toEqual([]);
    expect(player.release).toHaveBeenCalledTimes(1);

    const second = await harness.distube.play(TARGET, "b");
    await settle();
    const successor = harness.engine.players[1] as FakePlayer;

    expect(harness.engine.players).toHaveLength(2);
    expect(player.requests.map(request => request.itemId)).toEqual([first.items[0]?.id]);
    expect(successor.requests.map(request => request.itemId)).toEqual([second.items[0]?.id]);
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

    await expect(harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL })).rejects.toBe(preflightFailure);
    expect(harness.distube.voices.size).toBe(0);
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();

    const voice = await harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL });
    expect(voice.guildId).toBe(GUILD);
    expect(harness.distube.voices.size).toBe(1);
  });
});

describe("terminal disconnect", () => {
  it("deletes the guild's queue before publishing a platform disconnect, and publishes it once", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    await settle();
    const order = record(harness.distube, ["queue.deleted", "voice.disconnected"]);
    const disconnected = vi.fn();
    harness.distube.on("voice.disconnected", disconnected);

    harness.adapter.sessions[0]?.disconnect(new Error("dropped"));
    await settle();

    expect(order).toEqual(["queue.deleted", "voice.disconnected"]);
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
    await harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL });
    await harness.distube.voices.join({ guildId: SECOND, id: VOICE_CHANNEL });
    const reasons: string[] = [];
    harness.distube.on("voice.disconnected", event => reasons.push(`${event.guildId}:${event.reason}`));
    expect(harness.distube.voices.has(GUILD)).toBe(true);
    expect([...harness.distube.voices].map(voice => voice.guildId)).toEqual([GUILD, SECOND]);

    await harness.distube.dispose();

    expect(reasons.toSorted()).toEqual([`${GUILD}:shutdown`, `${SECOND}:shutdown`]);
    expect(harness.adapter.sessions.every(session => session.release.mock.calls.length === 1)).toBe(true);
    expect(harness.distube.voices.size).toBe(0);
    await expect(harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL })).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "DisTube is disposed",
    });
  });

  it("returns the same Promise to concurrent shutdown callers", async () => {
    const harness = playableSetup();
    const first = harness.distube.dispose();
    const second = harness.distube.dispose();

    expect(second).toBe(first);
    await first;
  });
});

describe("deferred DisTubeVoice lifetime", () => {
  it("leave waits for pending session creation and releases the late session once", async () => {
    const harness = playableSetup();
    const creation = harness.adapter.gateCreateSession();
    const joining = capture(harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL }));
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
    await harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL });
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
    expect(harness.distube.getQueue(GUILD)).toBe(fresh.queue);
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
    const joining = capture(harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL }));
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

    await expect(harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL })).rejects.toMatchObject({
      code: "VOICE_FAILED",
    });

    expect(session.release).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
  });

  it("joins failed DisTubeVoice construction cleanup before shutdown disposes Plugins", async () => {
    const disposed = vi.fn();
    const plugin = new FakeSource("construction-cleanup");
    plugin.dispose.mockImplementation(disposed);
    const harness = setup([], { sources: [plugin] });
    const creation = harness.adapter.gateCreateSession();
    const joining = capture(harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL }));
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
    await harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL });
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
    const voice = await harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL });
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

    expect(play.queue.state.current).toBeUndefined();
    expect(player.requests).toEqual([]);
    expect(player.calls).toEqual(["filters", "release"]);
    expect(player.listeners.size).toBe(0);
  });

  it("waits for Player release before releasing the session", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "first");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    const release = player.gate("release");

    const leaving = harness.distube.voices.leave(GUILD);
    await release.entered;

    expect(player.release).toHaveBeenCalledTimes(1);
    expect(session.release).not.toHaveBeenCalled();
    release.resolve();
    await leaving;
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("shares Player and session cleanup across repeated terminal callers", async () => {
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
    expect(session.release).not.toHaveBeenCalled();
    release.resolve();
    await first;

    expect(player.release).toHaveBeenCalledTimes(1);
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("releases the session after a Player cleanup failure", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "first");
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
    await harness.distube.play(TARGET, "first");
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
    const events = record(harness.distube, ["queue.item.finished", "queue.item.failed"]);

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
    const events = record(harness.distube, ["queue.item.started", "queue.item.failed", "queue.deleted"]);
    const deleted = deferred<void>();
    once(harness.distube, "queue.deleted", () => deleted.resolve());

    const { queue } = await harness.distube.play(TARGET, "first");
    await deleted.promise;

    expect(events).toEqual(["queue.item.started", "queue.item.failed", "queue.deleted"]);
    expect(queue.state.current).toBeUndefined();
  });

  it("retires a terminal Player before queue deletion can close its lease", async () => {
    const harness = playableSetup();
    const firstStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => firstStarted.resolve());
    const first = await harness.distube.play(TARGET, "first");
    await firstStarted.promise;
    const firstPlayer = harness.engine.players[0] as FakePlayer;

    firstPlayer.emit({
      type: "failed",
      itemId: firstPlayer.playing as string,
      error: new Error("decoder lost"),
      terminal: true,
    });
    await first.queue.stop();

    const secondStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => secondStarted.resolve());
    const second = await harness.distube.play(TARGET, "second");
    await secondStarted.promise;

    expect(harness.engine.createPlayer).toHaveBeenCalledTimes(2);
    expect(firstPlayer.requests.map(request => request.itemId)).toEqual([first.items[0]?.id]);
    expect((harness.engine.players[1] as FakePlayer).requests.map(request => request.itemId)).toEqual([
      second.items[0]?.id,
    ]);
  });

  it("fails the active item when a stale terminal outcome retires its Player", async () => {
    const harness = playableSetup();
    const first = await harness.distube.play(TARGET, "first");
    const second = await harness.distube.play(TARGET, "second");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const firstItem = first.items[0]?.id as string;
    const secondItem = second.items[0]?.id as string;

    player.emit({ type: "finished", itemId: firstItem });
    await settle();
    expect(first.queue.state.current?.id).toBe(secondItem);
    const events = record(harness.distube, ["queue.item.failed", "queue.deleted"]);
    const deleted = deferred<void>();
    once(harness.distube, "queue.deleted", () => deleted.resolve());

    player.emit({ type: "failed", itemId: firstItem, error: new Error("late decoder loss"), terminal: true });
    await deleted.promise;

    expect(events).toEqual(["queue.item.failed", "queue.deleted"]);
    expect(player.requests.map(request => request.itemId)).toEqual([firstItem, secondItem]);
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  it("retains a retired Player failure for a later DisTubeVoice release", async () => {
    const harness = playableSetup();
    const { items } = await harness.distube.play(TARGET, "first");
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

  it("publishes terminal DisTubeVoice loss as item failure, queue deletion, then DisTubeVoice disconnection", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    await harness.distube.play(TARGET, "first");
    await started.promise;
    expect(harness.distube.getQueue(GUILD)?.state.current).toBeDefined();
    const events = record(harness.distube, ["queue.item.failed", "queue.deleted", "voice.disconnected"]);
    const disconnected = deferred<void>();
    once(harness.distube, "voice.disconnected", () => disconnected.resolve());

    harness.adapter.sessions[0]?.disconnect(new Error("connection lost"));
    await disconnected.promise;

    expect(events).toEqual(["queue.item.failed", "queue.deleted", "voice.disconnected"]);
  });

  it("does not let a reentrant failure listener publish queue deletion first", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const { queue } = await harness.distube.play(TARGET, "first");
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

  it("shares one terminal completion across repeated leave calls", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    await harness.distube.play(TARGET, "first");
    await started.promise;
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    const releaseStarted = deferred<void>();
    const release = deferred<void>();
    session.release.mockImplementationOnce(async () => {
      releaseStarted.resolve();
      await release.promise;
    });
    const events = record(harness.distube, ["queue.deleted", "voice.disconnected"]);

    const first = harness.distube.voices.leave(GUILD);
    const second = harness.distube.voices.leave(GUILD);
    expect(second).toBe(first);
    await releaseStarted.promise;
    expect(harness.distube.voices.has(GUILD)).toBe(false);

    release.resolve();
    await first;
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["queue.deleted", "voice.disconnected"]);
  });

  it("serializes Player effects through the DisTubeVoice lease", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const { queue, items } = await harness.distube.play(TARGET, "first");
    await started.promise;
    const pauseGate = player.gate("pause");

    const pausing = queue.pause();
    await pauseGate.entered;
    const resuming = queue.resume();
    expect(player.resume).not.toHaveBeenCalled();

    pauseGate.resolve();
    await pausing;
    await resuming;
    expect(player.calls).toEqual(["volume:100", "filters", `play:${items[0]?.id}`, "pause", "resume"]);
  });

  it("serializes a filter commit behind the play effect it shares the Player lane with", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    // Held from before the borrow, so the play effect still occupies the lane when the commit lands.
    const playGate = player.gate("play");
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    await harness.distube.play(TARGET, "first");
    await playGate.entered;

    const applying = harness.distube.voices.get(GUILD)?.setFilters(["bassboost"]);
    await flushMicrotasks(32);
    // The activation's restore render already ran; the bassboost commit is queued behind the play.
    expect(player.renders).toEqual([[]]);

    playGate.resolve();
    await started.promise;
    await applying;
    await flushMicrotasks(32);

    expect(harness.distube.voices.get(GUILD)?.settings.filters).toEqual(["bassboost"]);
    expect(player.renders).toEqual([[], [{ name: "bassboost" }]]);
  });

  it("folds unawaited filter changes in invocation order", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "first");
    await settle();
    const voice = harness.distube.voices.get(GUILD);
    if (!voice) throw new Error("DisTubeVoice missing");

    const first = voice.setFilters(["bassboost"]);
    const second = voice.setFilters(["nightcore"]);
    await Promise.all([first, second]);

    expect(voice.settings.filters).toEqual(["nightcore"]);

    await voice.setFilters([]);
    const reapplied = voice.setFilters(["bassboost"]);
    const removed = voice.setFilters([]);
    await Promise.all([reapplied, removed]);

    expect(voice.settings.filters).toEqual([]);
  });

  it("commits queued DisTubeVoice settings when a Player retires before they run", async () => {
    const harness = playableSetup();
    const first = await harness.distube.play(TARGET, "first");
    await settle();
    const voice = harness.distube.voices.get(GUILD);
    if (!voice) throw new Error("DisTubeVoice missing");
    const player = harness.engine.players[0] as FakePlayer;
    const pause = player.gate("pause");

    const pausing = capture(first.queue.pause());
    await pause.entered;
    const volume = voice.setVolume(42);
    const filters = voice.setFilters(["nightcore"]);

    player.emit({
      type: "failed",
      itemId: first.items[0]?.id as string,
      error: new Error("Player retired"),
      terminal: true,
    });
    pause.resolve();
    await Promise.all([volume, filters]);
    await pausing;
    await settle();

    expect(voice.settings.volume).toBe(42);
    expect(voice.settings.filters).toEqual([]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();

    await harness.distube.play(TARGET, "second");
    await settle();
    const successor = harness.engine.players[1] as FakePlayer;

    expect(successor.volumes).toEqual([42]);
    expect(successor.renders).toEqual([[]]);
  });

  it("delivers successor Player outcomes through the existing queue lease", async () => {
    const harness = playableSetup();
    const first = await harness.distube.play(TARGET, "first");
    await first.queue.enqueue("second");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;

    player.emit({
      type: "failed",
      itemId: first.items[0]?.id as string,
      error: new Error("Player retired"),
      terminal: true,
    });
    await settle();

    const successor = harness.engine.players[1] as FakePlayer;
    expect(first.queue.state.current?.song.id).toBe("second");
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
    await voice?.setFilters(["nightcore"]);

    const firstPlayer = harness.engine.players[0] as FakePlayer;
    firstPlayer.emit({
      type: "failed",
      itemId: firstPlayer.playing as string,
      error: new Error("device lost"),
      terminal: true,
    });
    await settle();

    // A terminal failure deletes the exhausted queue; the next play borrows the replacement Player.
    await settle();
    expect(first.queue.state.current).toBeUndefined();
    const secondStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => secondStarted.resolve());
    await harness.distube.play(TARGET, "second");
    await secondStarted.promise;
    // The Engine supplies the replacement lazily, so it exists only once the next borrow needs it.
    const replacement = harness.engine.players[1] as FakePlayer;

    // One restore per Player, not one per lease or per track.
    expect(replacement.volumes).toEqual([40]);
    expect(replacement.renders).toEqual([[]]);
    expect(firstPlayer.volumes).toEqual([100, 40]);
    expect(firstPlayer.renders).toEqual([[], [{ name: "nightcore" }]]);
  });

  it("keeps the last committed DisTubeVoice channel when Adapter movement rejects", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join({ guildId: GUILD, id: VOICE_CHANNEL });
    const session = harness.adapter.sessions[0] as FakeVoiceSession;
    session.join.mockImplementationOnce(async channelId => {
      session.channelId = channelId;
      throw new Error("gateway move rejected");
    });

    await expect(voice.move({ guildId: GUILD, id: "other" })).rejects.toMatchObject({ code: "VOICE_FAILED" });

    expect(voice.channelId).toBe(VOICE_CHANNEL);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(VOICE_CHANNEL);
  });

  it("clears the committed filter chain when its queue is deleted", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const { queue } = await harness.distube.play(TARGET, "first");
    await started.promise;
    const voice = harness.distube.voices.get(GUILD);
    await voice?.setFilters(["bassboost"]);
    const player = harness.engine.players[0] as FakePlayer;

    await queue.stop();

    // Queue deletion clears rendering and keeps the connected backend.
    expect(voice?.settings.filters).toEqual([]);
    expect(voice?.settings.volume).toBe(100);
    expect(player.renders.at(-1)).toEqual([]);
    expect(player.release).not.toHaveBeenCalled();
  });

  it("keeps a replacement queue behind the old lease cleanup", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    const firstStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => firstStarted.resolve());
    const first = await harness.distube.play(TARGET, "first");
    await firstStarted.promise;
    const stop = player.gate("stop");

    const stopping = first.queue.stop();
    await stop.entered;
    const secondResolution = deferred<Song>();
    const secondResolved = deferred<void>();
    harness.source.resolve.mockImplementationOnce(async () => {
      secondResolved.resolve();
      return secondResolution.promise;
    });
    const secondStarted = deferred<void>();
    once(harness.distube, "queue.item.started", () => secondStarted.resolve());
    const replacement = harness.distube.play(TARGET, mediaUrl("second"));
    await secondResolved.promise;
    secondResolution.resolve(media("source", "second"));
    expect(harness.distube.getQueue(GUILD)).not.toBe(first.queue);
    expect(player.requests.map(request => request.itemId)).toEqual([first.items[0]?.id]);
    stop.resolve();
    await stopping;
    const second = await replacement;
    await secondStarted.promise;
    expect(player.requests.map(request => request.itemId)).toEqual([first.items[0]?.id, second.items[0]?.id]);
  });

  it("rejects an item effect whose authority ended while it waited in the DisTubeVoice lane", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.createPlayer.mockImplementationOnce(async () => {
      harness.engine.players.push(player);
      return player;
    });
    const started = deferred<void>();
    once(harness.distube, "queue.item.started", () => started.resolve());
    const { queue, items } = await harness.distube.play(TARGET, "first");
    await started.promise;
    const gateway = player.gate("gateway");
    const deleted = deferred<void>();
    once(harness.distube, "queue.deleted", () => deleted.resolve());

    (harness.adapter.sessions[0] as FakeVoiceSession).connect({
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
    const { queue, items } = await harness.distube.play(TARGET, "playing");
    await started.promise;
    const player = harness.engine.players[0] as FakePlayer;
    const outcomes = record(harness.distube, ["queue.item.finished", "queue.item.failed", "queue.deleted"]);

    // The Adapter republishes `connected` for a channel nobody asked us to join.
    (harness.adapter.sessions[0] as FakeVoiceSession).connect(
      { sessionId: "session", token: "token", endpoint: "endpoint" },
      "dragged",
    );
    await settle();

    expect(harness.distube.voices.get(GUILD)?.channelId).toBe("dragged");
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(queue.state.current?.id).toBe(items[0]?.id);
    expect(player.playing).toBe(items[0]?.id);
    expect(player.stopTrack).not.toHaveBeenCalled();
    expect(outcomes).toEqual([]);
  });
});
