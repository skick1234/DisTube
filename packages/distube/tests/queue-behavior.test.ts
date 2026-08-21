import { describe, expect, it, vi } from "vitest";
import {
  type DisTubeError,
  ErrorCode,
  Filters,
  type GuildQueue,
  Playlist,
  QueueItem,
  RepeatMode,
  type Song,
} from "../src";
import { deferred, FakePlayer, GUILD, media, playableSetup, record, settle, VOICE_CHANNEL } from "./support/harness";

const TARGET = { guildId: GUILD, voiceChannelId: VOICE_CHANNEL };

/** A playing queue holding `ids` in order: the first is current, the rest are waiting. */
async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const { queue } = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.enqueue(id);
  await settle();
  return { harness, queue, player: harness.engine.players[0] as FakePlayer };
}

const waiting = (queue: GuildQueue): string[] => queue.state.items.map(item => item.song.id);

describe("queue editing", () => {
  it("removes a range, reorders the rest, and never disturbs the current occurrence", async () => {
    const { queue } = await playing(["a", "b", "c", "d"]);

    const removed = await queue.remove({ from: 0, to: 1 });
    expect(removed.map(item => item.song.id)).toEqual(["b", "c"]);
    expect(waiting(queue)).toEqual(["d"]);

    await queue.enqueue("e");
    await queue.shuffle();
    expect(waiting(queue).toSorted()).toEqual(["d", "e"]);

    await queue.clear();
    expect(waiting(queue)).toEqual([]);
    expect(queue.state.current?.song.id).toBe("a");
  });
});

describe("repeat modes", () => {
  it("replays a naturally finished occurrence for Song and re-queues it for Queue", async () => {
    const { queue, player } = await playing(["a", "b"]);

    await queue.setRepeatMode(RepeatMode.Song);
    player.finish();
    await settle();
    expect(queue.state.current?.song.id).toBe("a");
    expect(waiting(queue)).toEqual(["b"]);

    await queue.setRepeatMode(RepeatMode.Queue);
    player.finish();
    await settle();
    expect(queue.state.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual(["a"]);
  });

  it("bypasses repeat when the caller ends the occurrence", async () => {
    const { queue } = await playing(["a", "b"]);
    await queue.setRepeatMode(RepeatMode.Song);

    await queue.skip();
    await settle();

    expect(queue.repeatMode).toBe(RepeatMode.Song);
    expect(queue.state.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
  });
});

describe("autoplay", () => {
  it("continues with a related Song once the queue runs out", async () => {
    const { harness, queue, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(media("source", "related"));

    await queue.setAutoplay(true);
    player.finish();
    await settle();

    expect(queue.autoplay).toBe(true);
    expect(queue.state.current?.song.id).toBe("related");
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
  });

  it("drops a related lookup that a committed user enqueue outran", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    harness.source.related.mockReturnValueOnce(lookup.promise);
    await queue.setAutoplay(true);

    player.finish();
    await settle();
    await queue.enqueue("b");
    await settle();
    lookup.resolve(media("source", "related"));
    await settle();

    expect(queue.state.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
  });

  it("reports a failed lookup against its seed, then exhausts the queue", async () => {
    const { harness, queue, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(undefined);
    const events = record(harness.distube, ["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    const failures: { song: Song; error: DisTubeError }[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push({ song: event.song, error: event.error }));
    await queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(events).toEqual(["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    expect(failures).toMatchObject([{ song: { id: "a" }, error: { code: ErrorCode.SOURCE_FAILED } }]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("retires a pending lookup when autoplay is disabled", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    const started = deferred<void>();
    let signal: AbortSignal | undefined;
    harness.source.related.mockImplementationOnce(async (_song, context) => {
      signal = context.signal;
      started.resolve();
      return lookup.promise;
    });
    const events = record(harness.distube, [
      "queue.finished",
      "queue.deleted",
      "queue.item.added",
      "queue.item.started",
      "queue.autoplay.failed",
    ]);
    await queue.setAutoplay(true);

    player.finish();
    await started.promise;
    await queue.setAutoplay(false);

    expect(signal?.aborted).toBe(true);
    expect(events).toEqual(["queue.finished", "queue.deleted"]);

    lookup.resolve(media("source", "related"));
    await settle();

    expect(events).toEqual(["queue.finished", "queue.deleted"]);
  });
});

describe("volume and filters", () => {
  it("exposes live queue state through the public facades and skips a redundant clear", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const metadata = { requester: "listener" };

    queue.metadata = metadata;
    player.position = 12;

    expect(queue.guildId).toBe(GUILD);
    expect(queue.metadata).toBe(metadata);
    expect(queue.currentTime).toBe(12);
    expect([...harness.distube.queues]).toEqual([queue]);

    await queue.filters.apply(Filters.Bassboost);
    await queue.filters.clear();
    const clearedRenders = player.renders.length;
    await queue.filters.clear();
    expect(player.renders).toHaveLength(clearedRenders);

    await queue.stop();
    expect(queue.currentTime).toBe(0);
  });

  it("holds a volume set before the borrow and keeps it across later changes", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    const creation = deferred<FakePlayer>();
    harness.engine.createPlayer.mockReturnValueOnce(creation.promise);
    const { queue } = await harness.distube.play(TARGET, "a");

    await queue.setVolume(40);
    expect(queue.volume).toBe(40);
    creation.resolve(player);
    await settle();
    await queue.setVolume(70);

    expect(player.volumes).toEqual([40, 70]);
    expect(queue.volume).toBe(70);
    await expect(queue.setVolume(-1)).rejects.toThrow(/volume/i);
  });

  it("folds a re-applied filter into its existing position and clears the set on deletion", async () => {
    const { queue, player } = await playing(["a"]);

    await queue.filters.apply(Filters.Bassboost);
    await queue.filters.apply(Filters.Nightcore, 1.2);
    await queue.filters.apply(Filters.Bassboost, 3);

    expect(queue.filters.active).toEqual([
      { name: Filters.Bassboost, value: 3 },
      { name: Filters.Nightcore, value: 1.2 },
    ]);
    expect(player.renders.at(-1)).toEqual(queue.filters.active);
    await expect(queue.filters.apply("nope")).rejects.toThrow("Unknown filter: nope");

    await queue.filters.remove(Filters.Bassboost);
    expect(queue.filters.active.map(entry => entry.name)).toEqual([Filters.Nightcore]);

    await queue.stop();
    await settle();
    // Deletion hands the borrowed Player back with nothing applied, ready for the next queue.
    expect(player.renders.at(-1)).toEqual([]);
  });
});

describe("progress and history", () => {
  it("replays a historical occurrence with its original metadata and a fresh identity", async () => {
    const harness = playableSetup();
    const metadataA = { requester: "A" };
    const metadataB = { requester: "B" };
    const { queue } = await harness.distube.play(TARGET, "a", { metadata: metadataA });
    await queue.enqueue("a", { metadata: metadataB });
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const first = queue.state.current as QueueItem;
    const second = queue.state.items[0] as QueueItem;
    const firstAddedAt = first.addedAt;

    player.finish();
    await settle();
    const historical = queue.previousSongs[0] as QueueItem;

    expect(historical).toBe(first);
    expect(queue.state.current).toBe(second);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(firstAddedAt.getTime() + 1_000));
    try {
      await queue.previous();
    } finally {
      vi.useRealTimers();
    }
    await settle();

    const replay = queue.state.current as QueueItem;
    expect(replay).toBeInstanceOf(QueueItem);
    expect(replay.song).toBe(first.song);
    expect(replay.metadata).toBe(metadataA);
    expect(replay.id).not.toBe(historical.id);
    expect(replay.addedAt.getTime()).toBeGreaterThan(historical.addedAt.getTime());
    expect(historical.id).toBe(first.id);
    expect(historical.song).toBe(first.song);
    expect(historical.addedAt.getTime()).toBe(firstAddedAt.getTime());
    expect(historical.metadata).toBe(metadataA);
    expect(queue.state.items[0]).toBe(second);
    expect(second.metadata).toBe(metadataB);
    expect(queue.previousSongs).toEqual([]);
  });

  it("caps exact historical occurrences and clears the stale facade on deletion", async () => {
    const ids = Array.from({ length: 102 }, (_value, index) => `song-${index}`);
    const { queue, player } = await playing(ids);
    const occurrences = [queue.state.current, ...queue.state.items] as QueueItem[];

    for (let index = 0; index < 101; index += 1) {
      player.finish();
      await settle();
    }

    expect(queue.previousSongs.map(item => item.id)).toEqual(occurrences.slice(1, 101).map(item => item.id));
    expect(queue.previousSongs).toHaveLength(100);

    const deletion = queue.stop();
    expect(queue.previousSongs).toEqual([]);
    expect(Object.isFrozen(queue.previousSongs)).toBe(true);
    await deletion;
  });
});

describe("deleted handles", () => {
  it("rejects every operation on a queue that was already deleted", async () => {
    const { queue } = await playing(["a"]);
    await queue.stop();

    const destroyed = "GuildQueue is destroyed";
    await expect(queue.enqueue("b")).rejects.toThrow(destroyed);
    await expect(queue.remove(0)).rejects.toThrow(destroyed);
    await expect(queue.skip()).rejects.toThrow(destroyed);
    await expect(queue.setVolume(50)).rejects.toThrow(destroyed);
    await expect(queue.filters.clear()).rejects.toThrow(destroyed);
    await expect(queue.setRepeatMode(RepeatMode.Song)).rejects.toThrow(destroyed);
  });

  it("fences stale mutations from a replacement queue in the same guild", async () => {
    const { harness, queue: first, player } = await playing(["a", "b"]);
    await first.skip();
    await settle();
    expect(first.previousSongs).toHaveLength(1);
    await first.stop();

    const { queue: replacement } = await harness.distube.play(TARGET, "c");
    await settle();
    const state = replacement.state;
    const calls = [...player.calls];

    await expect(first.enqueue("stale")).rejects.toMatchObject({ code: ErrorCode.QUEUE_FAILED });
    await expect(first.pause()).rejects.toMatchObject({ code: ErrorCode.QUEUE_FAILED });
    await expect(first.setVolume(20)).rejects.toMatchObject({ code: ErrorCode.QUEUE_FAILED });
    await expect(first.filters.set("stale-filter", { gain: 2 })).rejects.toMatchObject({
      code: ErrorCode.QUEUE_FAILED,
    });

    expect(first.previousSongs).toEqual([]);
    expect(Object.isFrozen(first.previousSongs)).toBe(true);
    expect(first.filters.active).toEqual([]);
    expect(replacement.state).toBe(state);
    expect(replacement.filters.active).toEqual([]);
    expect(replacement.previousSongs).toEqual([]);
    expect(player.calls).toEqual(calls);
    await harness.distube.shutdown();
  });
});

describe("event lifecycle", () => {
  it("publishes one ordered lifecycle and commits a Playlist as a single collection", async () => {
    const harness = playableSetup();
    const playlist = new Playlist({
      id: "list",
      name: "List",
      url: "https://source.example/list",
      source: "source",
      songs: [media("source", "x"), media("source", "y")],
    });
    harness.source.resolve.mockResolvedValueOnce(playlist);
    const events = record(harness.distube, [
      "queue.created",
      "queue.playlist.added",
      "queue.item.added",
      "queue.item.started",
      "queue.item.finished",
      "queue.finished",
      "queue.deleted",
    ]);

    await harness.distube.play(TARGET, playlist.url);
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    player.finish();
    await settle();
    player.finish();
    await settle();

    // The Playlist's own Songs publish no per-item added events.
    expect(events).toEqual([
      "queue.created",
      "queue.playlist.added",
      "queue.item.started",
      "queue.item.finished",
      "queue.item.started",
      "queue.item.finished",
      "queue.finished",
      "queue.deleted",
    ]);
  });
});
