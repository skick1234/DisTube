import { describe, expect, it } from "vitest";
import { ErrorCode, type PlaybackPreparation, type Song } from "../src";
import {
  capture,
  deferred,
  FakeSource,
  GUILD,
  media,
  mediaUrl,
  playableSetup,
  record,
  settle,
  setup,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, voiceChannelId: VOICE_CHANNEL };

describe("commit races", () => {
  it("registers one queue and one voice join for racing play calls", async () => {
    const harness = playableSetup();
    const [first, second] = await Promise.all([harness.distube.play(TARGET, "a"), harness.distube.play(TARGET, "b")]);
    await settle();

    expect(second.queue).toBe(first.queue);
    expect(harness.distube.queues.size).toBe(1);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.engine.players).toHaveLength(1);
    expect(first.items.map(item => item.song.id)).toEqual(["a"]);
    expect(second.items.map(item => item.song.id)).toEqual(["b"]);
    // Both insertions committed in call order; only the first one is playing.
    expect(first.queue.state.current?.song.id).toBe("a");
    expect(first.queue.state.items.map(item => item.song.id)).toEqual(["b"]);
  });

  it("continues playback for an enqueue that commits before the exhaustion decision", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.players[0];
    const events = record(harness.distube, ["queue.finished", "queue.deleted"]);

    await queue.enqueue("b");
    player?.finish();
    await settle();

    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(queue.state.current?.song.id).toBe("b");
    expect(events).toEqual([]);
  });

  it("rejects an enqueue whose resolution lands after exhaustion deleted the queue", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.players[0];
    const events = record(harness.distube, ["queue.finished", "queue.deleted"]);
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const late = capture(queue.enqueue(mediaUrl("b")));

    player?.finish();
    await settle();
    resolution.resolve(media("source", "b"));
    await settle();

    expect(await late).toMatchObject({ code: ErrorCode.QUEUE_FAILED });
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    // Exhaustion is observed exactly once, and the guild keeps its voice presence.
    expect(events).toEqual(["queue.finished", "queue.deleted"]);
    expect(player?.requests).toHaveLength(1);
    expect(harness.distube.voices.size).toBe(1);
  });
});

describe("terminal overlaps", () => {
  it("rejects a pending play when terminal queue authority arrives before its insertion", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "seed");
    await settle();
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const events = record(harness.distube, ["queue.item.added", "queue.item.started", "queue.deleted"]);
    const outcome = capture(harness.distube.play(TARGET, mediaUrl("slow")));

    await Promise.resolve();
    await queue.stop();
    resolution.resolve(media("source", "slow"));
    await settle();

    expect(await outcome).toMatchObject({ code: ErrorCode.QUEUE_FAILED });
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(queue.state.items).toEqual([]);
    expect(events).toEqual(["queue.deleted"]);
  });

  it("disposes a resource that arrives after stop, exactly once and with no terminal item event", async () => {
    const harness = playableSetup();
    const preparation = deferred<PlaybackPreparation>();
    const preparationStarted = deferred<void>();
    harness.source.preparePlayback.mockImplementationOnce(async () => {
      preparationStarted.resolve();
      return preparation.promise;
    });
    const events = record(harness.distube, [
      "queue.item.started",
      "queue.item.finished",
      "queue.item.failed",
      "queue.deleted",
    ]);
    const { queue } = await harness.distube.play(TARGET, "a");
    await preparationStarted.promise;
    const song = queue.state.items[0]?.song as Song;

    let stopped = false;
    const stopping = queue.stop().finally(() => {
      stopped = true;
    });
    expect(stopped).toBe(false);
    preparation.resolve(harness.source.resourceFor(song));
    await stopping;

    expect(harness.source.disposed).toEqual([song.id]);
    expect(events).toEqual(["queue.deleted"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("rejects a fallback candidate that completes after its item was removed", async () => {
    const owner = new FakeSource("owner");
    const fallback = new FakeSource("fallback");
    const candidate = deferred<PlaybackPreparation>();
    owner.resolve.mockImplementation(async url => media("owner", url.split("/").pop() as string));
    owner.preparePlayback.mockImplementation(async song =>
      song.id === "a" ? { kind: "search", query: "a" } : owner.resourceFor(song),
    );
    fallback.search.mockResolvedValue([media("fallback", "candidate")]);
    fallback.preparePlayback.mockReturnValue(candidate.promise);
    const harness = setup([owner, fallback]);

    const { queue } = await harness.distube.play(TARGET, mediaUrl("a", "owner"));
    await harness.distube.play(TARGET, mediaUrl("b", "owner"));
    await harness.distube.play(TARGET, mediaUrl("c", "owner"));
    await settle();
    const stuck = queue.state.items[0];

    const removed = await queue.remove(stuck?.id as string);
    await settle();
    candidate.resolve(fallback.resourceFor(media("fallback", "candidate")));
    await settle();

    expect(removed.map(item => item.song.id)).toEqual(["a"]);
    expect(fallback.disposed).toEqual(["candidate"]);
    // The waiting list keeps its order: the item behind the removed one plays next.
    expect(queue.state.current?.song.id).toBe("b");
    expect(queue.state.items.map(item => item.song.id)).toEqual(["c"]);
  });

  it("joins an in-flight deletion and disposes plugins only after every queue and voice settles", async () => {
    const harness = playableSetup();
    const other = { guildId: "other", voiceChannelId: VOICE_CHANNEL };
    const { queue } = await harness.distube.play(TARGET, "a");
    await harness.distube.play(other, "b");
    await settle();
    const order: string[] = [];
    harness.source.dispose.mockImplementation(() => {
      order.push("plugin.dispose");
    });
    for (const session of harness.adapter.sessions) {
      session.release.mockImplementation(async () => {
        order.push("session.release");
      });
    }
    harness.distube.on("queue.deleted", () => order.push("queue.deleted"));

    const stopping = capture(queue.stop());
    await harness.distube.shutdown();
    await stopping;

    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
    expect(order.filter(step => step === "queue.deleted")).toHaveLength(2);
    expect(order.indexOf("plugin.dispose")).toBeGreaterThan(order.lastIndexOf("session.release"));
    await expect(harness.distube.play(TARGET, "c")).rejects.toThrow("DisTube is shutting down");
  });
});

describe("edit overlaps", () => {
  it("applies an in-flight jump to the order a concurrent shuffle committed", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.players[0];
    await queue.enqueue("b");
    await queue.enqueue("c");
    const target = queue.state.items[1];
    const stopping = deferred<void>();
    player?.stopTrack.mockReturnValueOnce(stopping.promise);

    const jumped = capture(queue.jump(target?.id as string));
    const shuffled = queue.shuffle();
    stopping.resolve();
    await shuffled;
    await settle();

    expect(await jumped).toBeUndefined();
    expect(queue.state.current?.id).toBe(target?.id);
    expect(harness.distube.voices.get(GUILD)?.previousSongs.map(item => item.song.id)).toContain("a");
  });

  it("deletes the guild's queue before releasing the voice it was playing through", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const order: string[] = [];
    harness.distube.on("queue.deleted", () => order.push("queue.deleted"));
    harness.distube.on("voice.disconnected", event => order.push(`voice.disconnected:${event.reason}`));
    harness.adapter.sessions[0]?.release.mockImplementation(async () => {
      order.push("session.release");
    });

    await harness.distube.voices.leave(GUILD);

    expect(order).toEqual(["queue.deleted", "session.release", "voice.disconnected:left"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.size).toBe(0);
    expect(queue.state.current).toBeUndefined();
  });
});
