import { describe, expect, it, vi } from "vitest";
import { ErrorCode, Playlist, type Song } from "../src";
import {
  capture,
  deferred,
  FakeVoiceSession,
  GUILD,
  media,
  playableSetup,
  record,
  settle,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, voiceChannelId: VOICE_CHANNEL };
const MOVED_TARGET = { guildId: GUILD, voiceChannelId: "moved" };
const FIRST_PLAY_EVENTS = ["queue.created", "queue.item.added", "queue.item.started", "queue.deleted"] as const;

/** Flushes only queued microtasks. Each test controls all asynchronous boundaries with deferred Promises. */
async function flush(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
}

describe("transactional play", () => {
  it.each([
    [null, "input", undefined],
    [{ guildId: "", voiceChannelId: VOICE_CHANNEL }, "input", undefined],
    [{ guildId: GUILD, voiceChannelId: "" }, "input", undefined],
    [TARGET, "input", null],
    [TARGET, "input", { position: -1 }],
    [TARGET, "input", { position: 1.5 }],
  ] as const)("rejects malformed play input %# before starting owned work", async (target, input, options) => {
    const harness = playableSetup();

    await expect(harness.distube.play(target as never, input, options as never)).rejects.toMatchObject({
      code: ErrorCode.INVALID_ARGUMENT,
    });

    expect(harness.source.resolve).not.toHaveBeenCalled();
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();
    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
  });

  it("keeps a failing first resolution provisional and never starts playback", async () => {
    const harness = playableSetup();
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const events = record(harness.distube, FIRST_PLAY_EVENTS);
    const result = capture(harness.distube.play(TARGET, "unresolved"));

    await flush();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();

    resolution.reject(new Error("source rejected"));
    expect(await result).toMatchObject({ code: ErrorCode.SOURCE_FAILED });
    await flush();

    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.engine.players).toEqual([]);
    expect(events).toEqual([]);
  });

  it("rolls back a first Voice acquisition failure without exposing a queue", async () => {
    const harness = playableSetup();
    const resolution = deferred<Song>();
    const creation = deferred<never>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    harness.adapter.createVoiceSession.mockReturnValueOnce(creation.promise);
    const events = record(harness.distube, FIRST_PLAY_EVENTS);
    const result = capture(harness.distube.play(TARGET, "voice-failure"));

    resolution.resolve(media("source", "voice-failure"));
    await flush();
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();

    creation.reject(new Error("gateway rejected"));
    expect(await result).toMatchObject({ code: ErrorCode.VOICE_FAILED });
    await flush();

    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.engine.players).toEqual([]);
    expect(events).toEqual([]);
  });

  it("releases a Voice created solely by a first call rejected before commit", async () => {
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
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    const shutdown = harness.distube.shutdown();
    await flush();
    expect(harness.adapter.sessions[0]?.release).not.toHaveBeenCalled();
    continuePlay.resolve();
    await shutdown;
    expect(await result).toMatchObject({ code: ErrorCode.QUEUE_FAILED });

    expect(harness.adapter.sessions[0]?.release).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.engine.players).toEqual([]);
    expect(events).toEqual([]);
  });

  it("serializes concurrent first plays and preserves the second call after the first fails", async () => {
    const harness = playableSetup();
    const firstResolution = deferred<Song>();
    const secondResolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(firstResolution.promise).mockReturnValueOnce(secondResolution.promise);
    const first = capture(harness.distube.play(TARGET, "first"));
    const second = harness.distube.play(TARGET, "second");

    await flush();
    expect(harness.source.resolve).toHaveBeenCalledTimes(1);
    firstResolution.reject(new Error("first rejected"));
    expect(await first).toMatchObject({ code: ErrorCode.SOURCE_FAILED });

    await flush();
    expect(harness.source.resolve).toHaveBeenCalledTimes(2);
    secondResolution.resolve(media("source", "second"));
    const committed = await second;
    await flush();

    expect(harness.distube.getQueue(GUILD)).toBe(committed.queue);
    expect(committed.items.map(item => item.song.id)).toEqual(["second"]);
    expect(harness.distube.queues.size).toBe(1);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.size).toBe(1);
  });

  it("orders same-guild movement and insertion by play invocation", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    harness.distube.once("queue.item.started", () => started.resolve());
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
    const toC = harness.distube.play({ guildId: GUILD, voiceChannelId: "final" }, "c");

    await flush();
    expect(moves).toEqual([MOVED_TARGET.voiceChannelId]);
    firstMove.resolve();
    await toB;
    await toC;
    await flush();

    expect(moves).toEqual([MOVED_TARGET.voiceChannelId, "final"]);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe("final");
    expect(queue.state.current?.song.id).toBe("active");
    expect(queue.state.items.map(item => item.song.id)).toEqual(["b", "c"]);
  });

  it("publishes queue.created after the committed insertion is registered and before its item event", async () => {
    const harness = playableSetup();
    const order: string[] = [];
    harness.source.resolve.mockImplementation(async url => {
      order.push("resolved");
      return media("source", url);
    });
    harness.adapter.createVoiceSession.mockImplementation(async target => {
      order.push("voice");
      const session = new FakeVoiceSession(target.guildId, target.channelId);
      harness.adapter.sessions.push(session);
      return session;
    });
    harness.distube.on("queue.created", event => {
      order.push("queue.created");
      expect(harness.distube.getQueue(GUILD)).toBe(event.queue);
      expect(event.queue.state.items).toEqual([
        expect.objectContaining({ song: expect.objectContaining({ id: "ordered" }) }),
      ]);
    });
    harness.distube.on("queue.item.added", () => order.push("queue.item.added"));

    await harness.distube.play(TARGET, "ordered");

    expect(order).toEqual(["resolved", "voice", "queue.created", "queue.item.added"]);
  });

  it("treats skip on the first play as a no-op and starts the item once", async () => {
    const harness = playableSetup();
    const started = vi.fn();
    harness.distube.on("queue.item.started", started);

    const result = await harness.distube.play(TARGET, "first", { skip: true });
    await settle();

    expect(started).toHaveBeenCalledTimes(1);
    expect(harness.engine.players).toHaveLength(1);
    expect(harness.engine.players[0]?.requests).toHaveLength(1);
    expect(result.queue.state.current?.id).toBe(result.items[0]?.id);
  });

  it("commits the first insertion event before a reentrant queue stop", async () => {
    const harness = playableSetup();
    const order: string[] = [];
    let stopping: Promise<void> | undefined;
    harness.distube.on("queue.created", event => {
      order.push("queue.created");
      stopping = event.queue.stop();
    });
    harness.distube.on("queue.deleted", () => order.push("queue.deleted"));
    harness.distube.on("queue.item.added", () => order.push("queue.item.added"));

    await harness.distube.play(TARGET, "reentrant");
    await stopping;
    await flush();

    expect(order).toEqual(["queue.created", "queue.item.added", "queue.deleted"]);
  });

  it("leaves a Voice that predates a failed first play under its existing owner", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join({ guildId: GUILD, channelId: VOICE_CHANNEL });
    const session = harness.adapter.sessions[0];
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const result = capture(harness.distube.play(TARGET, "failed-with-existing-voice"));

    await flush();
    resolution.reject(new Error("source rejected"));
    expect(await result).toMatchObject({ code: ErrorCode.SOURCE_FAILED });
    await flush();

    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    expect(session?.release).not.toHaveBeenCalled();
  });

  it("moves the existing Voice, retains the active item, and removes queue channel authority", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    harness.distube.once("queue.item.started", () => started.resolve());
    const first = await harness.distube.play(TARGET, "active");
    await started.promise;
    const outcomes = record(harness.distube, ["queue.item.finished", "queue.item.failed"]);

    const moved = await harness.distube.play(MOVED_TARGET, "waiting");
    await flush();

    expect(moved.queue).toBe(first.queue);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(MOVED_TARGET.voiceChannelId);
    expect(first.queue.state.current?.song.id).toBe("active");
    expect(first.queue.state.items.map(item => item.song.id)).toEqual(["waiting"]);
    expect(outcomes).toEqual([]);
    expect("channelId" in first.queue).toBe(false);
  });

  it("keeps a successful move when the later insertion rejects", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    harness.distube.once("queue.item.started", () => started.resolve());
    const { queue } = await harness.distube.play(TARGET, "active");
    await started.promise;
    const playlist = new Playlist({
      id: "rejected-playlist",
      name: "Rejected playlist",
      url: "https://source.example/rejected-playlist",
      source: "source",
      songs: [media("source", "rejected")],
    });
    let songReads = 0;
    const rejectingPlaylist = new Proxy(playlist, {
      get(target, property, receiver) {
        if (property === "songs" && ++songReads > 1) throw new Error("insertion rejected");
        return Reflect.get(target, property, receiver);
      },
    });
    harness.source.resolve.mockReturnValueOnce(Promise.resolve(rejectingPlaylist));
    const result = capture(harness.distube.play(MOVED_TARGET, "rejected"));

    await flush();
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(MOVED_TARGET.voiceChannelId);
    expect(await result).toEqual(expect.any(Error));

    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(MOVED_TARGET.voiceChannelId);
    expect(queue.state.current?.song.id).toBe("active");
  });

  it("applies skip after a moved insertion commits", async () => {
    const harness = playableSetup();
    const firstStarted = deferred<void>();
    harness.distube.once("queue.item.started", () => firstStarted.resolve());
    const { queue, items: firstItems } = await harness.distube.play(TARGET, "active");
    await firstStarted.promise;
    const events = record(harness.distube, ["queue.item.added", "queue.item.finished"]);
    const nextStarted = deferred<void>();
    harness.distube.once("queue.item.started", () => nextStarted.resolve());

    const moved = await harness.distube.play(MOVED_TARGET, "next", { skip: true });
    await nextStarted.promise;

    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(MOVED_TARGET.voiceChannelId);
    expect(events).toEqual(["queue.item.added", "queue.item.finished"]);
    expect(moved.queue).toBe(queue);
    expect(moved.items[0]?.song.id).toBe("next");
    expect(queue.previousSongs.map(item => item.song.id)).toContain(firstItems[0]?.song.id);
    expect(queue.state.current?.song.id).toBe("next");
  });

  it("keeps the previous channel when movement itself fails", async () => {
    const harness = playableSetup();
    const started = deferred<void>();
    harness.distube.once("queue.item.started", () => started.resolve());
    const { queue } = await harness.distube.play(TARGET, "active");
    await started.promise;
    harness.adapter.sessions[0]?.join.mockRejectedValueOnce(new Error("cannot move"));

    await expect(harness.distube.play(MOVED_TARGET, "waiting")).rejects.toMatchObject({ code: ErrorCode.VOICE_FAILED });

    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(harness.distube.voices.get(GUILD)?.channelId).toBe(VOICE_CHANNEL);
    expect(queue.state.current?.song.id).toBe("active");
    expect(queue.state.items).toEqual([]);
  });
});
