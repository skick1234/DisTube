import { describe, expect, it } from "vitest";
import { type DisTubeError, Playlist, type Song } from "../src";
import {
  capture,
  deferred,
  deletions,
  FakeVoiceSession,
  GUILD,
  media,
  mediaUrl,
  playableSetup,
  record,
  required,
  settle,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };
const MOVED_TARGET = { guildId: GUILD, id: "moved" };
const FIRST_PLAY_EVENTS = ["queue.created", "queue.item.added", "queue.item.started", "queue.deleted"] as const;

/** Flushes only queued microtasks. Each test controls all asynchronous boundaries with deferred Promises. */
async function flush(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
}

describe("transactional play", () => {
  it.each([
    [null, "input", undefined],
    [{ guildId: "", id: VOICE_CHANNEL }, "input", undefined],
    [{ guildId: GUILD, id: "" }, "input", undefined],
    [TARGET, "", undefined],
  ] as const)("rejects malformed play input %# before starting owned work", async (target, input, options) => {
    const harness = playableSetup();

    await expect(harness.distube.play(target as never, input, options as never)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });

    expect(harness.source.resolve).not.toHaveBeenCalled();
    expect(harness.source.search).not.toHaveBeenCalled();
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();
    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
  });

  it("registers before resolution and deletes a failed first reservation without playback", async () => {
    const harness = playableSetup();
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const events = record(harness.distube, FIRST_PLAY_EVENTS);
    const result = capture(harness.distube.play(TARGET, mediaUrl("unresolved")));

    await flush();
    expect(harness.distube.getQueue(GUILD)).toMatchObject({ current: undefined, upcoming: [], status: "idle" });
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();

    resolution.reject(new Error("source rejected"));
    expect(await result).toMatchObject({ code: "SOURCE_FAILED" });
    await flush();

    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.engine.players).toEqual([]);
    expect(events).toEqual(["queue.created", "queue.deleted"]);
  });

  it("deletes the registered queue after first voice acquisition fails", async () => {
    const harness = playableSetup();
    const resolution = deferred<Song>();
    const creation = deferred<never>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    harness.adapter.createVoiceSession.mockReturnValueOnce(creation.promise);
    const events = record(harness.distube, FIRST_PLAY_EVENTS);
    const result = capture(harness.distube.play(TARGET, mediaUrl("voice-failure")));

    resolution.resolve(media("source", "voice-failure"));
    await flush();
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.distube.getQueue(GUILD)).toBeDefined();

    creation.reject(new Error("gateway rejected"));
    expect(await result).toMatchObject({ code: "VOICE_FAILED" });
    await flush();

    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.engine.players).toEqual([]);
    expect(events).toEqual(["queue.created", "queue.deleted"]);
  });

  it("releases a DisTubeVoice created solely by a first call rejected before commit", async () => {
    const harness = playableSetup();
    const joined = deferred<void>();
    const continuePlay = deferred<void>();
    harness.adapter.createVoiceSession.mockImplementationOnce(async target => {
      const session = new FakeVoiceSession(target.guildId, "other");
      harness.adapter.sessions.push(session);
      session.join.mockImplementationOnce(async channelId => {
        joined.resolve();
        await continuePlay.promise;
        session.channelId = channelId;
      });
      return session;
    });
    const events = record(harness.distube, FIRST_PLAY_EVENTS);
    const result = capture(harness.distube.play(TARGET, "fenced"));

    await joined.promise;
    expect(harness.distube.voices.has(GUILD)).toBe(true);
    expect(harness.distube.getQueue(GUILD)).toBeDefined();
    const shutdown = harness.distube.dispose();
    continuePlay.resolve();
    await shutdown;
    expect(await result).toMatchObject({ code: "INVALID_STATE" });

    expect(harness.adapter.sessions[0]?.release).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.engine.players).toEqual([]);
    expect(events).toEqual(["queue.created", "queue.deleted"]);
  });

  it("keeps a late session connected after the first play caller aborts", async () => {
    const harness = playableSetup();
    const creation = deferred<FakeVoiceSession>();
    const entered = deferred<void>();
    harness.adapter.createVoiceSession.mockImplementationOnce(() => {
      entered.resolve();
      return creation.promise;
    });
    const controller = new AbortController();
    const reason = new Error("caller cancelled during session creation");
    const result = capture(harness.distube.play(TARGET, "a", { signal: controller.signal }));
    await entered.promise;
    controller.abort(reason);

    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    creation.resolve(session);
    const failure = await result;
    expect(failure).toMatchObject({ code: "ABORTED", cause: reason });
    expect(failure).not.toBe(reason);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.get(GUILD)).toMatchObject({
      channelId: VOICE_CHANNEL,
      volume: 100,
      selfDeaf: true,
      selfMute: false,
    });
    expect(harness.distube.voices.get(GUILD)?.filters.names).toEqual([]);
    expect(session.release).not.toHaveBeenCalled();
    await harness.distube.voices.leave(GUILD);
    expect(session.release).toHaveBeenCalledTimes(1);
    await harness.distube.dispose();
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("observes caller cancellation after movement before inserting", async () => {
    const harness = playableSetup();
    const controller = new AbortController();
    const reason = new Error("caller cancelled after movement");
    const session = new FakeVoiceSession(GUILD, "other");
    session.join.mockImplementationOnce(async channelId => {
      session.channelId = channelId;
      controller.abort(reason);
    });
    harness.adapter.createVoiceSession.mockImplementationOnce(async () => {
      harness.adapter.sessions.push(session);
      return session;
    });
    const events = record(harness.distube, FIRST_PLAY_EVENTS);
    const failure = await capture(harness.distube.play(TARGET, "cancelled", { signal: controller.signal }));
    expect(failure).toMatchObject({ code: "ABORTED", cause: reason });
    expect(failure).not.toBe(reason);
    expect(session.join).toHaveBeenCalledWith(VOICE_CHANNEL);
    expect(events).toEqual(["queue.created", "queue.deleted"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    // The connection survives a failed first play; only leave or dispose releases it.
    expect(session.release).not.toHaveBeenCalled();
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(VOICE_CHANNEL);
    await harness.distube.dispose();
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("keeps a DisTubeVoice a concurrent join is awaiting after first play rolls back", async () => {
    const harness = playableSetup();
    const firstMoveStarted = deferred<void>();
    const finishFirstMove = deferred<void>();
    const joinedMoveStarted = deferred<void>();
    const finishJoinedMove = deferred<void>();
    const session = new FakeVoiceSession(GUILD, "other");
    let moves = 0;
    session.join.mockImplementation(async channelId => {
      moves += 1;
      if (moves === 1) {
        firstMoveStarted.resolve();
        await finishFirstMove.promise;
      } else {
        joinedMoveStarted.resolve();
        await finishJoinedMove.promise;
      }
      session.channelId = channelId;
    });
    harness.adapter.createVoiceSession.mockImplementationOnce(async () => {
      harness.adapter.sessions.push(session);
      return session;
    });
    const controller = new AbortController();
    const first = capture(harness.distube.play(TARGET, "first", { signal: controller.signal }));

    await firstMoveStarted.promise;
    const joining = harness.distube.voices.join({ guildId: GUILD, id: "joined" });
    controller.abort(new Error("first play failed"));
    finishFirstMove.resolve();
    await joinedMoveStarted.promise;
    finishJoinedMove.resolve();

    expect(await first).toMatchObject({ code: "ABORTED" });
    await expect(joining).resolves.toMatchObject({ guildId: GUILD, channelId: "joined" });
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe("joined");
    expect(session.release).not.toHaveBeenCalled();
    await harness.distube.dispose();
  });

  it("serializes concurrent first plays and preserves the second call after the first fails", async () => {
    const harness = playableSetup();
    const firstResolution = deferred<Song>();
    const secondResolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(firstResolution.promise).mockReturnValueOnce(secondResolution.promise);
    const first = capture(harness.distube.play(TARGET, mediaUrl("first")));
    const second = harness.distube.play(TARGET, mediaUrl("second"));

    await flush();
    expect(harness.source.resolve).toHaveBeenCalledTimes(1);
    firstResolution.reject(new Error("first rejected"));
    expect(await first).toMatchObject({ code: "SOURCE_FAILED" });

    await flush();
    expect(harness.source.resolve).toHaveBeenCalledTimes(2);
    secondResolution.resolve(media("source", "second"));
    const { queue: committed } = await second;
    await flush();

    expect(harness.distube.getQueue(GUILD)).toBe(committed);
    expect(
      [...(committed.current ? [committed.current] : []), ...committed.upcoming].map(item => item.song.id),
    ).toEqual(["second"]);
    expect(harness.distube.queues.size).toBe(1);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.size).toBe(1);
  });

  it("orders same-guild movement and insertion by play invocation", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    harness.distube.on("queue.item.started", () => started.resolve());
    const { queue } = await harness.distube.play(TARGET, "active");
    await started.promise;
    const firstMove = deferred<void>();
    const moves: string[] = [];
    const session = harness.adapter.sessions[0];
    if (!session) throw new Error("Expected an active VoiceSession");
    session.join.mockImplementation(async channelId => {
      moves.push(channelId);
      session.channelId = channelId;
    });
    session.join.mockImplementationOnce(async channelId => {
      moves.push(channelId);
      await firstMove.promise;
      session.channelId = channelId;
    });
    const toB = harness.distube.play(MOVED_TARGET, "b");
    const toC = harness.distube.play({ guildId: GUILD, id: "final" }, "c");

    await flush();
    expect(moves).toEqual([MOVED_TARGET.id]);
    firstMove.resolve();
    await toB;
    await toC;
    await flush();

    expect(moves).toEqual([MOVED_TARGET.id, "final"]);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe("final");
    expect(queue.current?.song.id).toBe("active");
    expect(queue.upcoming.map(item => item.song.id)).toEqual(["b", "c"]);
  });

  it("publishes the registered empty queue before resolution and insertion", async () => {
    const harness = playableSetup();
    const order: string[] = [];
    const resolution = deferred<Song>();
    harness.source.resolve.mockImplementation(async () => {
      order.push("resolve");
      return resolution.promise;
    });
    let created: { queue: unknown; state: unknown } | undefined;
    harness.distube.on("queue.created", event => {
      order.push("queue.created");
      created = event;
    });
    harness.distube.on("queue.item.added", () => order.push("queue.item.added"));
    const playing = harness.distube.play(TARGET, mediaUrl("ordered"));
    const registered = harness.distube.getQueue(GUILD);
    expect(registered).toBeDefined();
    expect(registered?.upcoming).toEqual([]);
    expect(harness.source.resolve).not.toHaveBeenCalled();
    await flush();
    expect(created?.queue).toBe(registered);
    expect(created?.state).toMatchObject({ current: undefined, upcoming: [], status: "idle" });
    expect(order).not.toContain("queue.item.added");
    resolution.resolve(media("source", "ordered"));
    expect((await playing).queue).toBe(registered);
    await flush();
    expect(order.indexOf("queue.created")).toBeLessThan(order.indexOf("queue.item.added"));
  });

  it("fences insertion when queue.created stops the early queue", async () => {
    const harness = playableSetup();
    const order: string[] = [];
    let stopping: Promise<void> | undefined;
    harness.distube.on("queue.created", event => {
      order.push("queue.created");
      stopping = event.queue.stop();
    });
    harness.distube.on("queue.deleted", () => order.push("queue.deleted"));
    harness.distube.on("queue.item.added", () => order.push("queue.item.added"));

    await expect(harness.distube.play(TARGET, "reentrant")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await stopping;
    await flush();

    expect(order).toEqual(["queue.created", "queue.deleted"]);
  });

  it("leaves a pre-existing voice and its settings untouched when the first play fails", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    await voice.setVolume(60);
    await voice.filters.set("bassboost", 15);
    await voice.setSelfDeaf(false);
    const session = required(harness.adapter.sessions[0]);
    harness.source.search.mockRejectedValueOnce(new Error("source failed"));

    await expect(harness.distube.play(TARGET, "bad")).rejects.toMatchObject({ code: "SOURCE_FAILED" });

    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    expect(session.release).not.toHaveBeenCalled();
    expect([voice.volume, voice.filters.names, voice.selfDeaf]).toEqual([60, ["bassboost"], false]);
    await harness.distube.dispose();
  });

  it("moves the existing DisTubeVoice, retains the active item, and removes queue channel authority", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    harness.distube.on("queue.item.started", () => started.resolve());
    const { queue: first } = await harness.distube.play(TARGET, "active");
    await started.promise;
    const outcomes = record(harness.distube, ["queue.item.finished", "queue.item.failed"]);

    const { queue: moved } = await harness.distube.play(MOVED_TARGET, "waiting");
    await flush();

    expect(moved).toBe(first);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(MOVED_TARGET.id);
    expect(first.current?.song.id).toBe("active");
    expect(first.upcoming.map(item => item.song.id)).toEqual(["waiting"]);
    expect(outcomes).toEqual([]);
    expect("channelId" in first).toBe(false);
  });

  it("keeps a successful move when the later insertion rejects", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    harness.distube.on("queue.item.started", () => started.resolve());
    const { queue } = await harness.distube.play(TARGET, "active");
    await started.promise;
    const playlist = new Playlist({
      id: "rejected-playlist",
      name: "Rejected playlist",
      url: "https://source.example/rejected-playlist",
      source: "source",
      songs: [media("source", "rejected")],
    });
    let moved = false;
    const session = harness.adapter.sessions[0];
    if (!session) throw new Error("Expected an active VoiceSession");
    session.join.mockImplementationOnce(async channelId => {
      session.channelId = channelId;
      moved = true;
    });
    const rejectingPlaylist = new Proxy(playlist, {
      get(target, property, receiver) {
        if (property === "songs" && moved) throw new Error("insertion rejected");
        return Reflect.get(target, property, receiver);
      },
    });
    harness.source.resolve.mockReturnValueOnce(Promise.resolve(rejectingPlaylist));
    const result = capture(harness.distube.play(MOVED_TARGET, mediaUrl("rejected")));

    await flush();
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(MOVED_TARGET.id);
    expect(await result).toEqual(expect.any(Error));

    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(MOVED_TARGET.id);
    expect(queue.current?.song.id).toBe("active");
  });

  it("keeps a move committed when the caller aborts the insertion after the join", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const controller = new AbortController();
    const session = harness.adapter.session;
    session.join.mockImplementationOnce(async channelId => {
      session.channelId = channelId;
      controller.abort();
    });
    const events = record(harness.distube, ["queue.item.added", "queue.item.started", "queue.item.failed"]);

    await expect(harness.distube.play(MOVED_TARGET, "b", { signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
    });
    await settle();

    expect(harness.source.search).toHaveBeenLastCalledWith("b", expect.anything());
    expect(queue.voice?.channelId).toBe(MOVED_TARGET.id);
    expect(harness.engine.player.playing).toBe("a");
    expect(queue.upcoming).toEqual([]);
    expect(events).toEqual([]);
  });

  it("keeps the previous channel when movement itself fails", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    harness.distube.on("queue.item.started", () => started.resolve());
    const { queue } = await harness.distube.play(TARGET, "active");
    await started.promise;
    harness.adapter.sessions[0]?.join.mockRejectedValueOnce(new Error("cannot move"));

    await expect(harness.distube.play(MOVED_TARGET, "waiting")).rejects.toMatchObject({ code: "VOICE_FAILED" });

    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(VOICE_CHANNEL);
    expect(queue.current?.song.id).toBe("active");
    expect(queue.upcoming).toEqual([]);
  });
});

describe("insertion steps", () => {
  it("rejects queue.add on a provisional queue whose guild has no voice and commits nothing", async () => {
    const harness = playableSetup();
    const reasons = deletions(harness.distube);
    const events = record(harness.distube, ["queue.item.added", "queue.item.started"]);
    const gate = harness.adapter.gateCreateSession();
    const started = capture(harness.distube.play(TARGET, "a"));
    const queue = required(harness.distube.getQueue(GUILD));
    const adding = capture(queue.add("b"));
    await settle();
    gate.reject(new Error("gateway down"));

    expect(await started).toMatchObject({ code: "VOICE_FAILED" });
    expect(await adding).toMatchObject({ code: "INVALID_STATE" });
    await settle();
    expect(queue.upcoming).toEqual([]);
    expect(events).toEqual([]);
    expect(reasons).toEqual(["failed"]);
  });

  it("commits mixed queue.add, play and queue.add from one tick in call order when they resolve in reverse", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const held = new Map(["b", "c", "d"].map(id => [id, deferred<readonly Song[]>()]));
    harness.source.search.mockImplementation(query => required(held.get(query)).promise);

    const steps = Promise.all([queue.add("b"), harness.distube.play(TARGET, "c"), queue.add("d")]);
    for (const id of ["d", "c", "b"]) required(held.get(id)).resolve([media("source", id)]);
    await steps;

    expect(queue.upcoming.map(item => item.song.id)).toEqual(["b", "c", "d"]);
  });

  it("resolves play with its queue and the item it inserted while the current item keeps playing", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    await settle();
    const queue = required(harness.distube.getQueue(GUILD));

    const result = await harness.distube.play(TARGET, "b");

    expect(result.queue).toBe(queue);
    expect(result.items.map(item => item.song.id)).toEqual(["b"]);
    expect(result.items[0]?.id).toBe(queue.upcoming[0]?.id);
    expect(harness.engine.player.playing).toBe("a");
  });

  it("resolves concurrent plays with only the items each committed", async () => {
    const harness = playableSetup<string>();
    const held = new Map(["b", "c"].map(id => [id, deferred<readonly Song[]>()]));
    harness.source.search.mockImplementation(query => required(held.get(query)).promise);
    const first = harness.distube.play(TARGET, "b", { metadata: "M1" });
    const second = harness.distube.play(TARGET, "c", { metadata: "M2" });
    for (const id of ["c", "b"]) required(held.get(id)).resolve([media("source", id)]);

    const [one, two] = await Promise.all([first, second]);

    expect(one.items.map(item => [item.song.id, item.metadata])).toEqual([["b", "M1"]]);
    expect(two.items.map(item => [item.song.id, item.metadata])).toEqual([["c", "M2"]]);
    expect(one.queue).toBe(two.queue);
  });

  it("drops a provider error that settles after the queue was deleted", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const held = deferred<readonly Song[]>();
    harness.source.search.mockImplementationOnce(() => held.promise);
    const adding = capture(queue.add("b"));
    await settle();
    await queue.stop();
    held.reject(new Error("provider saw the abort"));

    const failure = (await adding) as DisTubeError;
    expect(failure.code).toBe("INVALID_STATE");
    expect(failure.cause).toBeUndefined();
  });

  it("keeps a move failure as the cause when the queue was deleted during the move", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const move = deferred<void>();
    harness.adapter.session.join.mockImplementationOnce(() => move.promise);
    const moving = capture(harness.distube.play(MOVED_TARGET, "b"));
    await settle();
    await queue.stop();
    const down = new Error("gateway down");
    move.reject(down);

    const failure = (await moving) as DisTubeError;
    expect(failure.code).toBe("INVALID_STATE");
    expect(failure.cause).toMatchObject({ code: "VOICE_FAILED" });
    expect((failure.cause as DisTubeError).cause).toBe(down);
  });

  it("dispose waits for an in-flight insertion step before disposing plugins", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const held = deferred<readonly Song[]>();
    harness.source.search.mockImplementationOnce(() => held.promise);
    const adding = capture(queue.add("b"));
    await settle();

    const disposing = harness.distube.dispose();
    await settle();
    expect(harness.source.dispose).not.toHaveBeenCalled();

    held.resolve([media("source", "b")]);
    await disposing;
    expect(harness.source.dispose).toHaveBeenCalledTimes(1);
    expect(await adding).toMatchObject({ code: "INVALID_STATE" });
  });
});
