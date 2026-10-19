import { describe, expect, it } from "vitest";
import type { Song } from "../src";
import type { PlaybackPreparation } from "../src/integrations";
import {
  capture,
  deferred,
  FakeSource,
  GUILD,
  media,
  mediaUrl,
  playableSetup,
  record,
  required,
  settle,
  setup,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

describe("commit races", () => {
  it("registers one queue and one voice join for racing play calls", async () => {
    const harness = playableSetup();
    const [first, second] = await Promise.all([harness.distube.play(TARGET, "a"), harness.distube.play(TARGET, "b")]);
    await settle();

    expect(second).toBe(first);
    expect(harness.distube.queues.size).toBe(1);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.engine.players).toHaveLength(1);
    // Both insertions committed in call order; only the first one is playing.
    expect(first.current?.song.id).toBe("a");
    expect(first.upcoming.map(item => item.song.id)).toEqual(["b"]);
  });

  it("keeps an empty queue alive while an admitted add resolves", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.players[0];
    const events = record(harness.distube, ["queue.finished", "queue.deleted"]);
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const late = capture(queue.add(mediaUrl("b")));

    player?.finish();
    await settle();
    resolution.resolve(media("source", "b"));
    await settle();

    expect(await late).toHaveLength(1);
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(events).toEqual([]);
    expect(player?.requests).toHaveLength(2);
    expect(harness.distube.voices.size).toBe(1);
  });

  it("resolves a positional remove against the list committed when it runs, not when it was posted", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "a");
    await queue.add("b");
    await queue.add("c");
    await settle();
    const player = required(harness.engine.players[0]);
    const stop = player.gate("stop");

    // The skip parks the mailbox inside stopTrack, so the add and the remove queue behind it in order.
    const skipping = queue.skip();
    await stop.entered;
    const adding = queue.add("x", { next: true });
    await settle();
    const removing = queue.remove(2);
    stop.resolve();
    await skipping;
    await adding;
    await settle();

    // Position 2 named `c` when the call was made and `b` once `x` had committed at the head.
    expect((await removing).map(item => item.song.id)).toEqual(["b"]);
    expect(queue.current?.song.id).toBe("x");
    expect(queue.upcoming.map(item => item.song.id)).toEqual(["c"]);
  });
});

describe("terminal overlaps", () => {
  it("rejects a pending play when terminal queue authority arrives before its insertion", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "seed");
    await settle();
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const events = record(harness.distube, ["queue.item.added", "queue.item.started", "queue.deleted"]);
    const outcome = capture(harness.distube.play(TARGET, mediaUrl("slow")));

    await Promise.resolve();
    const stopping = queue.stop();
    resolution.resolve(media("source", "slow"));
    await stopping;
    await settle();

    expect(await outcome).toMatchObject({ code: "INVALID_STATE" });
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(queue.upcoming).toEqual([]);
    expect(events).toEqual(["queue.deleted"]);
  });

  it("waits for an in-flight preparation on stop and disposes its late resource once, with no terminal item event", async () => {
    const harness = playableSetup();
    const preparation = deferred<PlaybackPreparation>();
    const preparationStarted = deferred<void>();
    harness.source.stream.mockImplementationOnce(async () => {
      preparationStarted.resolve();
      return preparation.promise;
    });
    const events = record(harness.distube, [
      "queue.item.started",
      "queue.item.finished",
      "queue.item.failed",
      "queue.deleted",
    ]);
    const queue = await harness.distube.play(TARGET, "a");
    await preparationStarted.promise;
    const song = queue.upcoming[0]?.song as Song;

    let stopped = false;
    const stopping = queue.stop().finally(() => {
      stopped = true;
    });
    // stop joins the pending preparation, so it cannot settle while the stream is unresolved.
    await settle();
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
    owner.stream.mockImplementation(async song =>
      song.id === "a" ? { kind: "search", query: "a" } : owner.resourceFor(song),
    );
    fallback.search.mockResolvedValue([media("fallback", "candidate")]);
    fallback.stream.mockReturnValue(candidate.promise);
    const harness = setup([owner, fallback]);

    const queue = await harness.distube.play(TARGET, mediaUrl("a", "owner"));
    await harness.distube.play(TARGET, mediaUrl("b", "owner"));
    await harness.distube.play(TARGET, mediaUrl("c", "owner"));
    await settle();
    const stuck = queue.upcoming[0];

    await queue.remove(stuck?.id as string);
    await settle();
    candidate.resolve(fallback.resourceFor(media("fallback", "candidate")));
    await settle();

    expect(queue.upcoming.some(item => item.id === stuck?.id)).toBe(false);
    expect(fallback.disposed).toEqual(["candidate"]);
    // The waiting list keeps its order: the item behind the removed one plays next.
    expect(queue.current?.song.id).toBe("b");
    expect(queue.upcoming.map(item => item.song.id)).toEqual(["c"]);
  });

  it("joins an in-flight deletion and disposes plugins only after every queue and voice settles", async () => {
    const harness = playableSetup();
    const other = { guildId: "other", id: VOICE_CHANNEL };
    const queue = await harness.distube.play(TARGET, "a");
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
    await harness.distube.dispose();
    await stopping;

    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
    expect(order.filter(step => step === "queue.deleted")).toHaveLength(2);
    expect(order.indexOf("plugin.dispose")).toBeGreaterThan(order.lastIndexOf("session.release"));
    await expect(harness.distube.play(TARGET, "c")).rejects.toThrow("DisTube is disposed");
  });
});

describe("edit overlaps", () => {
  it("deletes the guild's queue before releasing the voice it was playing through", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "a");
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
    expect(queue.current).toBeUndefined();
  });
});
