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
  const voice = harness.distube.voices.get(GUILD);
  return {
    harness,
    queue,
    voice: voice as NonNullable<typeof voice>,
    player: harness.engine.players[0] as FakePlayer,
  };
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
    const { harness, queue, voice, player } = await playing(["a", "b"]);

    await voice.setRepeatMode(RepeatMode.Song);
    player.finish();
    await settle();
    expect(queue.state.current?.song.id).toBe("a");
    expect(waiting(queue)).toEqual(["b"]);

    await voice.setRepeatMode(RepeatMode.Queue);
    player.finish();
    await settle();
    expect(queue.state.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual(["a"]);
    await harness.distube.shutdown();
  });

  it("bypasses repeat when the caller ends the occurrence", async () => {
    const { harness, queue, voice } = await playing(["a", "b"]);
    await voice.setRepeatMode(RepeatMode.Song);

    await queue.skip();
    await settle();

    expect(voice.repeatMode).toBe(RepeatMode.Song);
    expect(queue.state.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
    await harness.distube.shutdown();
  });
});

describe("autoplay", () => {
  it("continues with a related Song once the queue runs out", async () => {
    const { harness, queue, voice, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(media("source", "related"));

    await voice.setAutoplay(true);
    player.finish();
    await settle();

    expect(voice.autoplay).toBe(true);
    expect(queue.state.current?.song.id).toBe("related");
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
  });

  it("drops a related lookup that a committed user enqueue outran", async () => {
    const { harness, queue, voice, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    harness.source.related.mockReturnValueOnce(lookup.promise);
    await voice.setAutoplay(true);

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
    const { harness, voice, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(undefined);
    const events = record(harness.distube, ["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    const failures: { song: Song; error: DisTubeError }[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push({ song: event.song, error: event.error }));
    await voice.setAutoplay(true);

    player.finish();
    await settle();

    expect(events).toEqual(["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    expect(failures).toMatchObject([{ song: { id: "a" }, error: { code: ErrorCode.SOURCE_FAILED } }]);
    // Nothing threw, so there is nothing to blame: no placeholder Error stands in for a cause.
    expect(failures[0]?.error.cause).toBeUndefined();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("publishes the provider's own Error as the cause when the lookup rejects", async () => {
    const { harness, voice, player } = await playing(["a"]);
    const provider = new Error("provider refused");
    harness.source.related.mockRejectedValue(provider);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    await voice.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures[0]?.code).toBe(ErrorCode.SOURCE_FAILED);
    expect(failures[0]?.cause).toBe(provider);
  });

  it("publishes no cause when the owning source has no related member", async () => {
    const { harness, voice, player } = await playing(["a"]);
    // A SourcePlugin that never implements autoplay, rather than one that declines.
    Reflect.deleteProperty(harness.source, "related");
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    await voice.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures[0]?.code).toBe(ErrorCode.SOURCE_FAILED);
    expect(failures[0]?.cause).toBeUndefined();
  });

  it("retires a pending lookup when autoplay is disabled on the Voice", async () => {
    const { harness, voice, player } = await playing(["a"]);
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
    await voice.setAutoplay(true);

    player.finish();
    await started.promise;
    await voice.setAutoplay(false);

    expect(signal?.aborted).toBe(true);
    expect(events).toEqual(["queue.finished", "queue.deleted"]);

    lookup.resolve(media("source", "related"));
    await settle();

    expect(events).toEqual(["queue.finished", "queue.deleted"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });
});

describe("queue metadata", () => {
  it("clears metadata at terminal authority and ignores writes from a stale handle", async () => {
    const { harness, queue } = await playing(["a"]);
    const beforeDeletion = { requester: "before" };
    const afterDeletion = { requester: "after" };
    const reads: unknown[] = [];
    queue.metadata = beforeDeletion;

    harness.distube.once("queue.deleted", event => {
      reads.push(event.queue.metadata);
      event.queue.metadata = afterDeletion;
      reads.push(event.queue.metadata);
    });
    await queue.stop();

    queue.metadata = afterDeletion;
    expect(reads).toEqual([undefined, undefined]);
    expect(queue.metadata).toBeUndefined();
  });
});

describe("volume and filters", () => {
  it("exposes live queue state through the public facades and skips a redundant clear", async () => {
    const { harness, queue, voice, player } = await playing(["a"]);
    const metadata = { requester: "listener" };

    queue.metadata = metadata;
    player.position = 12;

    expect(queue.guildId).toBe(GUILD);
    expect(queue.metadata).toBe(metadata);
    expect(queue.currentTime).toBe(12);
    expect([...harness.distube.queues]).toEqual([queue]);

    await voice.filters.apply(Filters.Bassboost);
    await voice.filters.clear();
    const clearedRenders = player.renders.length;
    await voice.filters.clear();
    expect(player.renders).toHaveLength(clearedRenders);

    await queue.stop();
    expect(queue.currentTime).toBe(0);
  });

  it("holds a volume set before the Player exists and keeps it across later changes", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    const creation = deferred<FakePlayer>();
    harness.engine.createPlayer.mockReturnValueOnce(creation.promise);
    await harness.distube.play(TARGET, "a");
    const voice = harness.distube.voices.get(GUILD) as NonNullable<ReturnType<typeof harness.distube.voices.get>>;

    await voice.setVolume(40);
    expect(voice.volume).toBe(40);
    creation.resolve(player);
    await settle();
    await voice.setVolume(70);

    // One restore push at activation, then one effect for the later change.
    expect(player.volumes).toEqual([40, 70]);
    expect(voice.volume).toBe(70);
    await expect(voice.setVolume(-1)).rejects.toThrow(/volume/i);
    await harness.distube.shutdown();
  });

  it("folds a re-applied filter into its existing position and keeps the set when the queue stops", async () => {
    const { queue, voice, player } = await playing(["a"]);

    await voice.filters.apply(Filters.Bassboost);
    await voice.filters.apply(Filters.Nightcore, 1.2);
    await voice.filters.apply(Filters.Bassboost, 3);

    expect(voice.filters.active).toEqual([
      { name: Filters.Bassboost, value: 3 },
      { name: Filters.Nightcore, value: 1.2 },
    ]);
    expect(player.renders.at(-1)).toEqual(voice.filters.active);
    await expect(voice.filters.apply("nope")).rejects.toThrow("Unknown filter: nope");

    await voice.filters.remove(Filters.Bassboost);
    expect(voice.filters.active.map(entry => entry.name)).toEqual([Filters.Nightcore]);

    await queue.stop();
    await settle();
    // Deletion belongs to the queue; the Voice's rendered chain stays right where it was.
    expect(voice.filters.active.map(entry => entry.name)).toEqual([Filters.Nightcore]);
    expect(player.renders.at(-1)).toEqual([{ name: Filters.Nightcore, value: 1.2 }]);
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
    const voice = harness.distube.voices.get(GUILD) as NonNullable<ReturnType<typeof harness.distube.voices.get>>;
    const player = harness.engine.players[0] as FakePlayer;
    const first = queue.state.current as QueueItem;
    const second = queue.state.items[0] as QueueItem;
    const firstAddedAt = first.addedAt;

    player.finish();
    await settle();
    const historical = voice.previousSongs[0] as QueueItem;

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
    expect(voice.previousSongs).toEqual([]);
  });

  it("caps exact historical occurrences and keeps them when the queue deletes", async () => {
    const ids = Array.from({ length: 102 }, (_value, index) => `song-${index}`);
    const { harness, queue, voice } = await playing(ids);
    const occurrences = [queue.state.current, ...queue.state.items] as QueueItem[];

    for (let index = 0; index < 101; index += 1) {
      (harness.engine.players[0] as FakePlayer).finish();
      await settle();
    }

    expect(voice.previousSongs.map(item => item.id)).toEqual(occurrences.slice(1, 101).map(item => item.id));
    expect(voice.previousSongs).toHaveLength(100);

    await queue.stop();
    // The bound history belongs to the Voice, so deletion cannot trim or unfreeze it.
    expect(voice.previousSongs.map(item => item.id)).toEqual(occurrences.slice(1, 101).map(item => item.id));
    expect(Object.isFrozen(voice.previousSongs)).toBe(true);
  });
});

describe("durable voice settings", () => {
  it("keeps settings and history past deletion, and a later play inherits them", async () => {
    const harness = playableSetup();
    const firstStarted = deferred<void>();
    harness.distube.once("queue.item.started", () => firstStarted.resolve());
    await harness.distube.play(TARGET, "a");
    await firstStarted.promise;
    const voice = harness.distube.voices.get(GUILD) as NonNullable<ReturnType<typeof harness.distube.voices.get>>;
    await voice.setVolume(50);
    await voice.filters.apply(Filters.Nightcore);

    // Exhaust the first queue so its deletion happens naturally, with `a` in history.
    (harness.engine.players[0] as FakePlayer).finish();
    await settle();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(voice.volume).toBe(50);
    expect(voice.filters.active).toEqual([{ name: Filters.Nightcore }]);
    expect(voice.previousSongs.map(item => item.song.id)).toEqual(["a"]);

    const secondStarted = deferred<void>();
    harness.distube.once("queue.item.started", () => secondStarted.resolve());
    const second = await harness.distube.play(TARGET, "b");
    await secondStarted.promise;
    const player = harness.engine.players[0] as FakePlayer;

    // No bot-side re-application: the Voice kept the same Player, and it already carries the settings.
    expect(harness.engine.players).toHaveLength(1);
    expect(player.volumes).toEqual([100, 50]);
    expect(player.renders).toEqual([[], [{ name: Filters.Nightcore }]]);
    expect(second.queue.guildId).toBe(GUILD);

    // History outlives the previous queue too, so `previous()` replays across the boundary.
    await second.queue.previous();
    await settle();
    expect(second.queue.state.current?.song.id).toBe("a");
    expect(waiting(second.queue)).toEqual(["b"]);
    // `b` was requeued rather than played to its end, so history is empty once `a` is popped off it.
    expect(voice.previousSongs).toEqual([]);
  });

  it("applies committed volume once per Player rather than once per track", async () => {
    const { harness, queue, voice, player } = await playing(["a", "b", "c"]);
    await voice.setVolume(35);
    expect(player.volumes).toEqual([100, 35]);

    // Each skip settles first: advancing needs an active track, and the successor only becomes
    // active once its own activation completes.
    await queue.skip();
    await settle();
    await queue.skip();
    await settle();

    // Two further tracks started on the same borrow with no additional volume effects.
    expect(player.calls.filter(call => call.startsWith("volume:"))).toEqual(["volume:100", "volume:35"]);
    expect(player.requests.map(request => request.itemId)).toHaveLength(3);
    expect(queue.state.current?.song.id).toBe("c");
    await harness.distube.shutdown();
  });
});

describe("deleted handles", () => {
  it("rejects every operation on a queue that was already deleted", async () => {
    const { harness, queue, voice } = await playing(["a"]);
    await queue.stop();

    const destroyed = "GuildQueue is destroyed";
    await expect(queue.enqueue("b")).rejects.toThrow(destroyed);
    await expect(queue.remove(0)).rejects.toThrow(destroyed);
    await expect(queue.skip()).rejects.toThrow(destroyed);
    await expect(queue.pause()).rejects.toThrow(destroyed);
    await expect(queue.previous()).rejects.toThrow(destroyed);

    // The settings commands are gone from the queue surface, and the Voice still owns them.
    await expect(voice.setRepeatMode(RepeatMode.Song)).resolves.toBeUndefined();
    expect(voice.repeatMode).toBe(RepeatMode.Song);
    await harness.distube.shutdown();
  });

  it("fences stale mutations from a replacement queue in the same guild", async () => {
    const { harness, queue: first, voice } = await playing(["a", "b"]);
    await first.skip();
    await settle();
    expect(voice.previousSongs).toHaveLength(1);
    await first.stop();

    const { queue: replacement } = await harness.distube.play(TARGET, "c");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    const state = replacement.state;
    const calls = [...player.calls];

    await expect(first.enqueue("stale")).rejects.toMatchObject({ code: ErrorCode.QUEUE_FAILED });
    await expect(first.pause()).rejects.toMatchObject({ code: ErrorCode.QUEUE_FAILED });

    // Deletion kept the Voice intact, so the replacement inherited everything, including history.
    expect(voice.previousSongs.map(item => item.song.id)).toEqual(["a"]);
    expect(Object.isFrozen(voice.previousSongs)).toBe(true);
    expect(voice.filters.active).toEqual([]);
    expect(replacement.state).toBe(state);
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
