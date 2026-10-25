import { describe, expect, it } from "vitest";
import { type DisTubeError, type DisTubeEventMap, type DisTubeQueue, Playlist, type Song } from "../src";
import {
  deferred,
  deletions,
  type FakePlayer,
  GUILD,
  media,
  playableSetup,
  record,
  required,
  settle,
  thrown,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

/** A playing queue holding `ids` in order: the first is current, the rest are waiting. */
async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const queue = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.add(id);
  await settle();
  const voice = harness.distube.voices.get(GUILD);
  return {
    harness,
    queue,
    voice: voice as NonNullable<typeof voice>,
    player: harness.engine.players[0] as FakePlayer,
  };
}

const waiting = (queue: DisTubeQueue): string[] => queue.upcoming.map(item => item.song.id);

describe("repeat modes", () => {
  it("replays a naturally finished occurrence for Song and re-queues it for Queue", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    const first = required(queue.current);

    queue.setRepeat("song");
    expect(queue.repeat).toBe("song");
    player.finish();
    await settle();
    expect(queue.current?.song.id).toBe("a");
    // A new occurrence of the same Song, not the ended one.
    expect(queue.current?.id).not.toBe(first.id);
    expect(queue.current?.song).toBe(first.song);
    expect(waiting(queue)).toEqual(["b"]);

    queue.setRepeat("queue");
    player.finish();
    await settle();
    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual(["a"]);
    await harness.distube.dispose();
  });

  it("bypasses repeat when the caller ends the occurrence", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    queue.setRepeat("song");

    await queue.skip();
    await settle();

    expect(queue.repeat).toBe("song");
    expect(player.release).not.toHaveBeenCalled();
    expect(harness.engine.players).toEqual([player]);
    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
    await harness.distube.dispose();
  });

  it("does not repeat a failed item in queue mode", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    queue.setRepeat("queue");
    player.fail(new Error("decoder failed"));
    await settle();

    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
    expect(queue.history).toEqual([]);
    expect(harness.source.disposed).toEqual(["a"]);
    player.finish();
    await settle();

    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
    expect(player.played).toEqual(["a", "b", "b"]);
    await harness.distube.dispose();
  });

  it("rejects an unknown repeat mode before committing", async () => {
    const { harness, queue } = await playing(["a"]);
    expect(thrown(() => queue.setRepeat("forever" as never))).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(thrown(() => queue.setAutoplay("yes" as never))).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect([queue.repeat, queue.autoplay]).toEqual(["off", false]);
    await harness.distube.dispose();
  });
});

describe("autoplay", () => {
  it("continues with a related Song once the queue runs out", async () => {
    const { harness, queue, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(media("source", "related"));

    queue.setAutoplay(true);
    player.finish();
    await settle();

    expect(queue.autoplay).toBe(true);
    expect(queue.current?.song.id).toBe("related");
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
  });

  it("marks the related item as autoplay and carries the metadata of the item it followed", async () => {
    const harness = playableSetup();
    const requester = { member: "user-1", channel: "text-1" };
    harness.source.related.mockResolvedValueOnce(media("source", "related"));
    const added: { autoplay: boolean; metadata: unknown }[] = [];
    harness.distube.on("queue.item.added", ({ item }) => void added.push(item));
    const queue = await harness.distube.play(TARGET, "a", { metadata: requester });
    queue.setAutoplay(true);
    queue.setRepeat("song");
    await settle();
    const first = required(queue.current);

    queue.setRepeat("off");
    await queue.skip();
    await settle();
    const related = required(queue.current);
    queue.setRepeat("song");
    required(harness.engine.players[0]).finish();
    await settle();

    expect([first.autoplay, related.song.id, related.autoplay]).toEqual([false, "related", true]);
    expect(related.metadata).toBe(requester);
    expect(added.at(-1)).toBe(related);
    expect([required(queue.current).id === related.id, required(queue.current).autoplay]).toEqual([false, true]);
    expect(required(queue.current).metadata).toBe(requester);
  });

  it("drops a related lookup that a committed user add outran", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    harness.source.related.mockReturnValueOnce(lookup.promise);
    queue.setAutoplay(true);

    player.finish();
    await settle();
    await queue.add("b");
    await settle();
    lookup.resolve(media("source", "related"));
    await settle();

    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
  });

  it("reports a failed lookup against its seed, then exhausts the queue", async () => {
    const { harness, queue, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(undefined);
    const events = record(harness.distube, ["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    const failures: { song: Song; error: DisTubeError }[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push({ song: event.song, error: event.error }));
    queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(events).toEqual(["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    expect(failures).toMatchObject([{ song: { id: "a" }, error: { code: "SOURCE_FAILED" } }]);
    // Nothing threw, so there is nothing to blame: no placeholder Error stands in for a cause.
    expect(failures[0]?.error.cause).toBeUndefined();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("publishes the provider's own Error as the cause when the lookup rejects", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const provider = new Error("provider refused");
    harness.source.related.mockRejectedValue(provider);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures[0]?.code).toBe("SOURCE_FAILED");
    expect(failures[0]?.cause).toBe(provider);
  });

  it("publishes no cause when the owning source has no related member", async () => {
    const { harness, queue, player } = await playing(["a"]);
    // A Plugin that never implements autoplay, rather than one that declines.
    Reflect.deleteProperty(harness.source, "related");
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures[0]?.code).toBe("SOURCE_FAILED");
    expect(failures[0]?.cause).toBeUndefined();
  });

  it("retires a pending lookup when autoplay is disabled on the queue", async () => {
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
    queue.setAutoplay(true);

    player.finish();
    await started.promise;
    queue.setAutoplay(false);
    await settle();

    expect(signal?.aborted).toBe(true);
    expect(events).toEqual(["queue.finished", "queue.deleted"]);

    lookup.resolve(media("source", "related"));
    await settle();

    expect(events).toEqual(["queue.finished", "queue.deleted"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it.each(["prepare", "play"] as const)(
    "ends the queue after an autoplay item fails to %s, with one lookup",
    async stage => {
      const { harness, queue, player } = await playing(["a"]);
      harness.source.related.mockResolvedValue(media("source", "related"));
      if (stage === "prepare")
        harness.source.stream.mockImplementation(async song => {
          if (song.id === "related") throw new Error("geo blocked");
          return harness.source.resource(song.id);
        });
      else player.play.mockRejectedValueOnce(new Error("cannot start"));
      const events = record(harness.distube, ["queue.item.failed", "queue.finished"]);
      const reasons = deletions(harness.distube);
      queue.setAutoplay(true);

      player.finish();
      await settle();

      expect(harness.source.related).toHaveBeenCalledTimes(1);
      expect(events).toEqual(["queue.item.failed", "queue.finished"]);
      expect(reasons).toEqual(["finished"]);
    },
  );

  it.each([
    ["the queue is deleted", (queue: Awaited<ReturnType<typeof playing>>["queue"]) => queue.stop(), "stop", ["a"]],
    [
      "the user adds an item",
      (queue: Awaited<ReturnType<typeof playing>>["queue"]) => queue.add("b"),
      undefined,
      ["a", "b"],
    ],
    [
      "autoplay is disabled",
      (queue: Awaited<ReturnType<typeof playing>>["queue"]) => queue.setAutoplay(false),
      "finished",
      ["a"],
    ],
  ] as const)("drops an autoplay result that lands after %s", async (_name, act, reason, played) => {
    const { harness, queue, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    harness.source.related.mockImplementationOnce(() => lookup.promise);
    const events = record(harness.distube, ["queue.item.added", "queue.autoplay.failed"]);
    const reasons = deletions(harness.distube);
    queue.setAutoplay(true);
    player.finish();
    await settle();
    expect(harness.source.related).toHaveBeenCalledTimes(1);

    await act(queue);
    lookup.resolve(media("source", "related"));
    await settle();

    expect(player.played).toEqual(played);
    expect(queue.upcoming.map(item => item.song.id)).not.toContain("related");
    expect(events).toEqual(reason === undefined ? ["queue.item.added"] : []);
    expect(reasons).toEqual(reason === undefined ? [] : [reason]);
  });

  it.each(["prepare", "play"] as const)("keeps autoplay available after a user item fails to %s", async stage => {
    const { harness, queue, player } = await playing(["a", "b"]);
    harness.source.related.mockResolvedValue(media("source", "related"));
    if (stage === "prepare")
      harness.source.stream.mockImplementation(async song => {
        if (song.id === "b") throw new Error("geo blocked");
        return harness.source.resource(song.id);
      });
    else player.play.mockRejectedValueOnce(new Error("cannot start"));
    queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(harness.source.related).toHaveBeenCalledTimes(1);
    expect(player.playing).toBe("related");
  });

  it("keeps the queue for an insertion still resolving when the lookup declines", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    harness.source.related.mockReturnValueOnce(lookup.promise);
    const resolving = deferred<readonly Song[]>();
    harness.source.search.mockReturnValueOnce(resolving.promise);
    const reasons = deletions(harness.distube);
    const events = record(harness.distube, ["queue.finished"]);
    queue.setAutoplay(true);
    player.finish();
    await settle();

    const adding = queue.add("b");
    await settle();
    lookup.resolve(undefined);
    await settle();
    expect(events).toEqual([]);
    expect(harness.distube.getQueue(GUILD)).toBe(queue);

    resolving.resolve([media("source", "b")]);
    await adding;
    await settle();
    expect(player.playing).toBe("b");
    expect(events).toEqual([]);
    expect(reasons).toEqual([]);
  });

  it("publishes no queue.finished when the queue is stopped during the lookup", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    harness.source.related.mockReturnValueOnce(lookup.promise);
    const events = record(harness.distube, ["queue.finished", "queue.deleted"]);
    queue.setAutoplay(true);
    player.finish();
    await settle();

    await queue.stop();
    lookup.resolve(undefined);
    await settle();

    expect(events).toEqual(["queue.deleted"]);
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

  it("captures immutable state that does not change after later commits", async () => {
    const { harness, queue, player } = await playing(["a", "b", "c"]);
    const captures: DisTubeEventMap["queue.item.started"][] = [];
    harness.distube.on("queue.item.started", event => captures.push(event));
    await queue.skip();
    await settle();
    player.finish();
    await settle();
    // Read after both commits: a live view would show the later state in the first capture.
    expect(captures.map(event => event.state.upcoming.map(item => item.song.id))).toEqual([["c"], []]);
    expect(Object.isFrozen(captures[0]?.state)).toBe(true);
    await harness.distube.dispose();
  });
});

describe("queue occurrence edits and lifetime", () => {
  it("moves and removes only upcoming occurrence IDs", async () => {
    const { harness, queue } = await playing(["a", "b", "c", "d"]);
    const [b, , d] = queue.upcoming;
    queue.move(required(d).id, required(b).id);
    expect(waiting(queue)).toEqual(["d", "b", "c"]);
    expect(queue.remove(required(b).id).map(item => item.id)).toEqual([b?.id]);
    expect(waiting(queue)).toEqual(["d", "c"]);
    expect(queue.current?.song.id).toBe("a");
    expect(thrown(() => queue.remove(required(b).id))).toMatchObject({ code: "INVALID_STATE" });
    expect(thrown(() => queue.move(required(queue.current).id))).toMatchObject({ code: "INVALID_STATE" });
    await harness.distube.dispose();
  });

  it("removes only the named occurrence when the same Song is added twice", async () => {
    const { harness, queue } = await playing(["a"]);
    const song = media("source", "duplicate");
    const first = required((await queue.add(song))[0]);
    const second = required((await queue.add(song))[0]);
    expect(first.song).toBe(song);
    expect(second.song).toBe(song);
    expect(first.id).not.toBe(second.id);

    expect(queue.remove(first.id).map(item => item.id)).toEqual([first.id]);
    expect(queue.upcoming.map(item => item.id)).toEqual([second.id]);
    await queue.skip();
    await settle();
    expect(queue.current).toBe(second);
    await harness.distube.dispose();
  });

  it("keeps volume and filters on the voice while repeat and autoplay reset with the queue", async () => {
    const { harness, queue, voice, player } = await playing(["a"]);
    await voice.setVolume(40);
    expect(voice.volume).toBe(40);
    expect(player.volumes.at(-1)).toBe(40);
    expect(player.playing).toBe(queue.current?.song.id);
    await voice.filters.set("bassboost", 15);
    queue.setRepeat("queue");
    queue.setAutoplay(true);
    const rendered = player.renders.length;

    const stopped = queue.stop();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(queue.stop()).toBe(stopped);
    await stopped;

    // Queue deletion is not a filter reset: the committed set and its rendering stay.
    expect(player.renders.length).toBe(rendered);
    expect(voice.volume).toBe(40);
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 15, label: "Bass +15dB" }]);
    expect([queue.repeat, queue.autoplay, queue.history]).toEqual(["off", false, []]);

    const replacement = await harness.distube.play(TARGET, "b");
    expect(replacement).not.toBe(queue);
    expect([replacement.repeat, replacement.autoplay]).toEqual(["off", false]);
    await expect(queue.add("c")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(thrown(() => queue.setRepeat("song"))).toMatchObject({ code: "INVALID_STATE" });
    expect(harness.distube.getQueue(GUILD)).toBe(replacement);

    await harness.distube.voices.leave(GUILD);
    const fresh = await harness.distube.voices.join(TARGET);
    expect([fresh.volume, fresh.filters.names, fresh.selfDeaf, fresh.selfMute]).toEqual([100, [], true, false]);
    await harness.distube.dispose();
  });
});
