import { describe, expect, it, vi } from "vitest";
import { type DisTubeQueue, Playlist, type QueueItem } from "../src";
import type { PlaybackPreparation } from "../src/integrations";
import {
  deferred,
  type FakePlayer,
  GUILD,
  media,
  playableSetup,
  record,
  required,
  settle,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

/** A playing queue holding `ids` in order: the first is current, the rest are waiting. */
async function playing(ids: readonly string[], metadata?: unknown) {
  const harness = playableSetup();
  const queue = await harness.distube.play(TARGET, ids[0] as string, { metadata });
  for (const id of ids.slice(1)) await queue.add(id, { metadata });
  await settle();
  return { harness, queue, player: harness.engine.players[0] as FakePlayer };
}

const waiting = (queue: DisTubeQueue): string[] => queue.upcoming.map(item => item.song.id);
const remembered = (queue: DisTubeQueue): string[] => queue.history.map(item => item.song.id);

describe("insertion position", () => {
  it("inserts with next and at, appending past the end", async () => {
    const { harness, queue } = await playing(["current", "b", "c"]);
    const added = record(harness.distube, ["queue.item.added"]);

    await queue.add("a", { next: true });
    expect(waiting(queue)).toEqual(["a", "b", "c"]);
    await queue.add("d", { at: 10 });
    expect(waiting(queue)).toEqual(["a", "b", "c", "d"]);
    await queue.add("x", { at: 2 });
    expect(waiting(queue)).toEqual(["a", "b", "x", "c", "d"]);
    await settle();
    expect(added).toHaveLength(3);
    expect(queue.current?.song.id).toBe("current");
    await harness.distube.dispose();
  });

  it("inserts a Playlist contiguously at a position and publishes one collection event", async () => {
    const { harness, queue } = await playing(["current", "x", "y"]);
    const playlist = new Playlist({
      id: "list",
      name: "List",
      url: "https://source.example/list",
      source: "source",
      songs: [media("source", "p1"), media("source", "p2")],
    });
    const events = record(harness.distube, ["queue.playlist.added", "queue.item.added"]);
    const items: string[] = [];
    harness.distube.on("queue.playlist.added", event => items.push(...event.items.map(item => item.song.id)));

    await queue.add(playlist, { at: 1 });
    await settle();

    expect(waiting(queue)).toEqual(["x", "p1", "p2", "y"]);
    expect(events).toEqual(["queue.playlist.added"]);
    expect(items).toEqual(["p1", "p2"]);
    await harness.distube.dispose();
  });

  it("rejects next together with at, and malformed positions, before resolving the input", async () => {
    const { harness, queue } = await playing(["current"]);
    await expect(queue.add("a", { next: true, at: 1 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.add("a", { at: -1 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.add("a", { at: 1.5 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.play(TARGET, "a", { next: "yes" as never })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(waiting(queue)).toEqual([]);
    // The only search is the initial play of "current"; no rejected call reached resolution.
    expect(harness.source.search).toHaveBeenCalledTimes(1);
    await harness.distube.dispose();
  });

  it("evaluates a position when the insertion commits, not when the call is made", async () => {
    const { harness, queue } = await playing(["current", "b"]);
    const slow = deferred<readonly ReturnType<typeof media>[]>();
    harness.source.search.mockReturnValueOnce(slow.promise);
    // The first add is stuck in resolution; the second targets the same position and is queued behind it.
    const first = queue.add("slow", { at: 0 });
    const second = queue.add("fast", { at: 0 });
    slow.resolve([media("source", "slow")]);
    await Promise.all([first, second]);
    expect(waiting(queue)).toEqual(["fast", "slow", "b"]);
    await harness.distube.dispose();
  });
});

describe("jump", () => {
  it("jumps by position with requeue: the target plays and the skipped items return to the tail", async () => {
    const { harness, queue, player } = await playing(["a", "b", "c", "d"]);
    const events = record(harness.distube, ["queue.item.finished", "queue.history.added", "queue.item.started"]);

    await queue.jump(2, { requeue: true });
    await settle();

    expect(queue.current?.song.id).toBe("c");
    expect(waiting(queue)).toEqual(["d", "a", "b"]);
    expect(remembered(queue)).toEqual([]);
    expect(events).toEqual(["queue.item.started"]);
    expect(player.stopTrack).toHaveBeenCalledTimes(1);
    expect(player.playing).toBe(queue.current?.id);
    await harness.distube.dispose();
  });

  it("jumps by ID without requeue: the skipped items enter history in order", async () => {
    const { harness, queue } = await playing(["a", "b", "c", "d"]);
    const events = record(harness.distube, ["queue.item.finished", "queue.history.added", "queue.item.started"]);
    const target = required(queue.upcoming[1]);

    await queue.jump(target.id);
    await settle();

    expect(queue.current).toBe(target);
    expect(waiting(queue)).toEqual(["d"]);
    expect(remembered(queue)).toEqual(["a", "b"]);
    expect(events).toEqual(["queue.history.added", "queue.history.added", "queue.item.started"]);
    await harness.distube.dispose();
  });

  it("rejects a stale target with INVALID_STATE and a malformed one with INVALID_ARGUMENT", async () => {
    const { harness, queue } = await playing(["a", "b"]);
    await expect(queue.jump("missing")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.jump(5)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.jump(required(queue.current).id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.jump(0)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.jump("")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.jump(1.5)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(queue.current?.song.id).toBe("a");
    expect(waiting(queue)).toEqual(["b"]);
    await harness.distube.dispose();
  });
});

describe("previous", () => {
  it("replays the newest history Song as a new occurrence and returns the current item to the front", async () => {
    const requester = { by: "skick" };
    const { harness, queue } = await playing(["s", "a", "b"], requester);
    await queue.skip();
    await settle();
    const ended = required(queue.history.at(-1));
    const current = required(queue.current);
    expect([ended.song.id, current.song.id]).toEqual(["s", "a"]);

    await queue.previous();
    await settle();

    const replay = required(queue.current);
    expect(replay.song).toBe(ended.song);
    expect(replay.id).not.toBe(ended.id);
    expect(replay.metadata).toBe(requester);
    expect(queue.upcoming.map(item => item.id)).toEqual([current.id, required(queue.upcoming[1]).id]);
    expect(waiting(queue)).toEqual(["a", "b"]);
    expect(remembered(queue)).toEqual([]);
    await harness.distube.dispose();
  });

  it("rejects with INVALID_STATE when history is empty and leaves playback unchanged", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    await expect(queue.previous()).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(queue.current?.song.id).toBe("a");
    expect(player.stopTrack).not.toHaveBeenCalled();
    await harness.distube.dispose();
  });
});

describe("shuffle, clear and remove", () => {
  it("shuffles the waiting list around the same current item", async () => {
    const ids = ["current", ...Array.from({ length: 10 }, (_, index) => `w${index}`)];
    const { harness, queue } = await playing(ids);

    // Math.random() === 0 always picks index 0, which rotates the waiting list by one.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await queue.shuffle();
    } finally {
      random.mockRestore();
    }

    expect(queue.current?.song.id).toBe("current");
    expect(waiting(queue)).toEqual(["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w0"]);
    await harness.distube.dispose();
  });

  it("clears the waiting list and cancels a pending preparation, disposing its late resource once", async () => {
    const harness = playableSetup();
    const prepared = deferred<PlaybackPreparation>();
    let signal: AbortSignal | undefined;
    const late = { disposed: 0 };
    harness.source.stream.mockImplementationOnce(async song => harness.source.resourceFor(song));
    harness.source.stream.mockImplementationOnce(async (_song, context) => {
      signal = context.signal;
      return prepared.promise;
    });
    const queue = await harness.distube.play(TARGET, "a");
    await queue.add("b");
    await queue.add("c");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    player.finish();
    await settle();
    // "b" is now being prepared behind the deferred stream.
    expect(signal).toBeDefined();
    expect(queue.current).toBeUndefined();

    await queue.clear();

    expect(queue.upcoming).toEqual([]);
    expect(signal?.aborted).toBe(true);
    prepared.resolve({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/late", dispose: () => void late.disposed++ },
    });
    await settle();
    expect(late.disposed).toBe(1);
    expect(player.requests.map(request => request.itemId)).toHaveLength(1);
    await harness.distube.dispose();
  });

  it("keeps the current item playing when clear runs mid-track", async () => {
    const { harness, queue, player } = await playing(["a", "b", "c"]);
    await queue.clear();
    expect(queue.current?.song.id).toBe("a");
    expect(queue.upcoming).toEqual([]);
    expect(player.playing).toBe(queue.current?.id);
    expect(player.stopTrack).not.toHaveBeenCalled();
    await harness.distube.dispose();
  });

  it("removes by one-based position and by inclusive range, returning the removed items in order", async () => {
    const { harness, queue } = await playing(["a", "b", "c", "d", "e"]);
    const [b, c, d, e] = queue.upcoming as readonly QueueItem[];

    expect((await queue.remove({ from: 2, to: 3 })).map(item => item.id)).toEqual([c?.id, d?.id]);
    expect(waiting(queue)).toEqual(["b", "e"]);
    expect((await queue.remove(2)).map(item => item.id)).toEqual([e?.id]);
    expect(waiting(queue)).toEqual(["b"]);
    expect((await queue.remove(required(b).id)).map(item => item.id)).toEqual([b?.id]);
    expect(waiting(queue)).toEqual([]);
    await harness.distube.dispose();
  });

  it("rejects malformed and non-upcoming remove targets without touching the queue", async () => {
    const { harness, queue } = await playing(["a", "b", "c"]);
    await expect(queue.remove({ from: 3, to: 2 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.remove({ from: 0, to: 1 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.remove(0)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.remove({ from: 1, to: 5 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.remove(3)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.remove("")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: "Occurrence ID must be a non-empty string",
    });
    await expect(queue.remove(required(queue.current).id)).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Occurrence is not upcoming in this queue",
    });
    expect(waiting(queue)).toEqual(["b", "c"]);
    await harness.distube.dispose();
  });

  it("rejects every edit on a deleted queue with INVALID_STATE", async () => {
    const { harness, queue } = await playing(["a", "b"]);
    const [b] = queue.upcoming;
    await queue.stop();
    await expect(queue.jump(1)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.previous()).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.shuffle()).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.clear()).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.remove(1)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.move(required(b).id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.skip()).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.addRelated()).rejects.toMatchObject({ code: "INVALID_STATE" });
    await harness.distube.dispose();
  });
});
