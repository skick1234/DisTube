import { describe, expect, it } from "vitest";
import { type DisTube, DisTubeError, type DisTubeEventMap, type DisTubeQueue, ErrorCode, Playlist, Song } from "../src";
import type { PlaybackResource, Plugin } from "../src/integrations";
import {
  deferred,
  deletions,
  type FakePlayer,
  FakeSource,
  GUILD,
  type HarnessOptions,
  media,
  playableSetup,
  record,
  required,
  settle,
  setup,
  thrown,
  updates,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const { queue } = await harness.distube.play(TARGET, ids[0] as string);
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

async function autoplaying(options: HarnessOptions, lists: Readonly<Record<string, readonly string[]>> = {}) {
  const harness = playableSetup("source", options);
  radio(harness.source, lists);
  const { queue } = await harness.distube.play(TARGET, "a");
  queue.setAutoplay(true);
  await settle();
  return { harness, queue, player: harness.engine.player };
}

function radio(source: FakeSource, lists: Readonly<Record<string, readonly string[]>>): void {
  source.related.mockImplementation(async (seed, { exclude }) => {
    const id = lists[seed.id]?.find(candidate => !exclude.some(song => song.id === candidate));
    return id === undefined ? undefined : media(source.name, id);
  });
}

function failing(source: FakeSource, ids: readonly string[]): void {
  source.stream.mockImplementation(async song => {
    if (ids.includes(song.id)) throw new Error("no copy");
    return source.resource(song.id);
  });
}

const lookups = (source: FakeSource) =>
  source.related.mock.calls.map(([seed, { exclude }]) => [seed.id, exclude.map(song => song.id)] as const);

function autoplayFailures(distube: DisTube) {
  const failed: DisTubeEventMap["queue.item.failed"][] = [];
  const stopped: DisTubeEventMap["queue.autoplay.failed"][] = [];
  distube.on("queue.item.failed", event => void failed.push(event));
  distube.on("queue.autoplay.failed", event => void stopped.push(event));
  return { failed, stopped };
}

describe("repeat modes", () => {
  it("replays a naturally finished occurrence for Song and re-queues it for Queue", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    const first = required(queue.current);

    queue.setRepeat("song");
    expect(queue.repeat).toBe("song");
    player.finish();
    await settle();
    expect(queue.current?.song.id).toBe("a");
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
    const harness = playableSetup<unknown>();
    const requester = { member: "user-1", channel: "text-1" };
    harness.source.related.mockResolvedValueOnce(media("source", "related"));
    const added: { autoplay: boolean; metadata: unknown }[] = [];
    harness.distube.on("queue.item.added", ({ item }) => void added.push(item));
    const { queue } = await harness.distube.play(TARGET, "a", { metadata: requester });
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

  it("cancels a related lookup when an add starts, so the added item plays before any related Song", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    const resolving = deferred<readonly Song[]>();
    let lookupSignal: AbortSignal | undefined;
    harness.source.related.mockImplementationOnce((_song, { signal }) => {
      lookupSignal = signal;
      return lookup.promise;
    });
    harness.source.search.mockImplementationOnce(() => resolving.promise);
    queue.setAutoplay(true);
    player.finish();
    await settle();

    const adding = queue.add("b");
    await settle();
    lookup.resolve(media("source", "related"));
    await settle();
    resolving.resolve([media("source", "b")]);
    await adding;
    await settle();

    expect(lookupSignal?.aborted).toBe(true);
    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
  });

  it("plays a previous replay without waiting for a pending related lookup", async () => {
    const { harness, queue, player } = await playing(["a"]);
    harness.source.related.mockReturnValueOnce(new Promise<never>(() => undefined));
    queue.setAutoplay(true);

    player.finish();
    await settle();
    await queue.previous();
    await settle();

    expect(player.played).toEqual(["a", "a"]);
    expect(queue.current?.song.id).toBe("a");
  });

  it.each([
    [
      "returns undefined",
      (source: FakeSource) => source.related.mockResolvedValue(undefined),
      "source returned no related Song",
    ],
    [
      "has no related member",
      (source: FakeSource) => Reflect.deleteProperty(source, "related"),
      "source has no related lookup",
    ],
  ])(
    "reports NO_RESULT against its seed when the plugin %s, then exhausts the queue",
    async (_case, decline, message) => {
      const { harness, queue, player } = await playing(["a"]);
      decline(harness.source);
      const events = record(harness.distube, ["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
      const failures: { song: Song; error: DisTubeError }[] = [];
      harness.distube.on("queue.autoplay.failed", event => failures.push({ song: event.song, error: event.error }));
      queue.setAutoplay(true);

      player.finish();
      await settle();

      expect(events).toEqual(["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
      expect(failures).toMatchObject([{ song: { id: "a" }, error: { code: "NO_RESULT", source: "source", message } }]);
      expect(failures[0]?.error.cause).toBeUndefined();
      expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    },
  );

  it("publishes the provider's own Error as the cause when the lookup rejects", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const provider = new Error("provider refused");
    harness.source.related.mockRejectedValue(provider);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures[0]).toMatchObject({ code: "SOURCE_FAILED", source: "source" });
    expect(failures[0]?.cause).toBe(provider);
  });

  it("publishes a DisTubeError the plugin throws unchanged", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const declined = new DisTubeError(ErrorCode.NO_RESULT, "radio returned 49 entries, 49 already played", {
      source: "source",
    });
    harness.source.related.mockRejectedValue(declined);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toBe(declined);
  });

  it("refuses an age-restricted related Song until the queue allows age-restricted Songs", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const { id, name, url, source } = media("source", "adult");
    harness.source.related.mockResolvedValue(new Song({ id, name, url, source, ageRestricted: true }));
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(queue.allowAgeRestricted).toBe(false);
    expect(harness.source.related).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "a" }),
      expect.objectContaining({ allowAgeRestricted: false }),
    );
    expect(failures).toMatchObject([
      { code: "NO_RESULT", source: "source", message: "source returned an age-restricted related Song" },
    ]);
    expect(failures[0]?.cause).toBeUndefined();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();

    const allowing = await playing(["a"]);
    allowing.harness.source.related.mockResolvedValue(new Song({ id, name, url, source, ageRestricted: true }));
    allowing.queue.setAutoplay(true);
    allowing.queue.setAllowAgeRestricted(true);

    allowing.player.finish();
    await settle();

    expect(allowing.harness.source.related).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "a" }),
      expect.objectContaining({ allowAgeRestricted: true }),
    );
    expect(allowing.queue.current?.song.id).toBe("adult");
  });

  it("refuses an age-restricted related Song when the queue stops allowing them during the lookup", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const { id, name, url, source } = media("source", "adult");
    const lookup = deferred<Song | undefined>();
    const started = deferred<void>();
    harness.source.related.mockImplementationOnce(async () => {
      started.resolve();
      return lookup.promise;
    });
    const events = record(harness.distube, ["queue.item.added", "queue.autoplay.failed", "queue.deleted"]);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    queue.setAutoplay(true);
    queue.setAllowAgeRestricted(true);

    player.finish();
    await started.promise;
    queue.setAllowAgeRestricted(false);
    lookup.resolve(new Song({ id, name, url, source, ageRestricted: true }));
    await settle();

    expect(events).toEqual(["queue.autoplay.failed", "queue.deleted"]);
    expect(failures).toMatchObject([{ code: "NO_RESULT", message: "source returned an age-restricted related Song" }]);
  });

  it("rejects a non-boolean allowAgeRestricted on the queue INVALID_ARGUMENT", async () => {
    const { queue } = await playing(["a"]);
    expect(thrown(() => queue.setAllowAgeRestricted("yes" as never))).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(queue.allowAgeRestricted).toBe(false);
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
      const events = record(harness.distube, ["queue.item.failed", "queue.autoplay.failed", "queue.finished"]);
      const { failed, stopped } = autoplayFailures(harness.distube);
      const reasons = deletions(harness.distube);
      queue.setAutoplay(true);

      player.finish();
      await settle();

      expect(harness.source.related).toHaveBeenCalledTimes(1);
      expect(events).toEqual(["queue.item.failed", "queue.autoplay.failed", "queue.finished"]);
      expect(stopped.map(event => [event.song.id, event.item?.id, event.error])).toEqual([
        ["a", failed[0]?.item.id, failed[0]?.error],
      ]);
      expect(reasons).toEqual(["finished"]);
    },
  );

  it.each(["prepare", "play"] as const)(
    "with autoplayAttempts 3, plays the next related Song of the same seed after an autoplay item fails to %s",
    async stage => {
      const { harness, player } = await autoplaying({ autoplayAttempts: 3 }, { a: ["r1", "r2"] });
      if (stage === "prepare") failing(harness.source, ["r1"]);
      else player.play.mockRejectedValueOnce(new Error("cannot start"));
      const { stopped } = autoplayFailures(harness.distube);

      player.finish();
      await settle();

      expect(player.playing).toBe("r2");
      expect(lookups(harness.source)).toEqual([
        ["a", ["a"]],
        ["a", ["a", "r1"]],
      ]);
      expect(stopped).toEqual([]);
    },
  );

  it("counts failed autoplay items again from zero once an autoplay item starts", async () => {
    const { harness, player } = await autoplaying({ autoplayAttempts: 2 }, { a: ["r1", "r2"], r2: ["r3", "r4"] });
    failing(harness.source, ["r1", "r3"]);
    const { stopped } = autoplayFailures(harness.distube);

    player.finish();
    await settle();
    player.finish();
    await settle();

    expect(player.played).toEqual(["a", "r2", "r4"]);
    expect(stopped).toEqual([]);
  });

  it("with autoplayAttempts 3, reports the third failed autoplay item once and then finishes", async () => {
    const { harness, player } = await autoplaying({ autoplayAttempts: 3 }, { a: ["r1", "r2", "r3", "r4"] });
    failing(harness.source, ["r1", "r2", "r3"]);
    const events = record(harness.distube, ["queue.item.failed", "queue.autoplay.failed", "queue.finished"]);
    const { failed, stopped } = autoplayFailures(harness.distube);
    const reasons = deletions(harness.distube);

    player.finish();
    await settle();

    expect(lookups(harness.source).map(([seed]) => seed)).toEqual(["a", "a", "a"]);
    expect(failed.map(event => event.item.song.id)).toEqual(["r1", "r2", "r3"]);
    expect(events).toEqual([
      "queue.item.failed",
      "queue.item.failed",
      "queue.item.failed",
      "queue.autoplay.failed",
      "queue.finished",
    ]);
    expect(stopped.map(event => [event.song.id, event.item?.id, event.error])).toEqual([
      ["a", failed[2]?.item.id, failed[2]?.error],
    ]);
    expect(reasons).toEqual(["finished"]);
  });

  it("with autoplayAttempts 3, ends autoplay at once when the lookup finds nothing", async () => {
    const { harness, player } = await autoplaying({ autoplayAttempts: 3 });
    const events = record(harness.distube, ["queue.autoplay.failed", "queue.finished"]);
    const { stopped } = autoplayFailures(harness.distube);

    player.finish();
    await settle();

    expect(harness.source.related).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["queue.autoplay.failed", "queue.finished"]);
    expect(stopped.map(event => [event.song.id, event.item, event.error.code])).toEqual([
      ["a", undefined, ErrorCode.NO_RESULT],
    ]);
  });

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

  it.each([
    ["plays the candidate owner's related Song", "related", ["queue.item.added"]],
    [
      "reports the Spotify Song when the candidate owner finds none",
      undefined,
      ["queue.autoplay.failed", "queue.finished"],
    ],
  ] as const)("after a Spotify item played through a YouTube candidate, %s", async (_name, relatedId, events) => {
    const spotify: Plugin = { name: "spotify", resolve: async () => undefined };
    const youtube = new FakeSource("youtube");
    const candidate = media("youtube", "candidate");
    youtube.search.mockResolvedValue([candidate]);
    youtube.related.mockResolvedValueOnce(relatedId === undefined ? undefined : media("youtube", relatedId));
    const harness = setup([spotify, youtube]);
    const log = record(harness.distube, ["queue.item.added", "queue.autoplay.failed", "queue.finished"]);
    const failedSongs: Song[] = [];
    harness.distube.on("queue.autoplay.failed", event => void failedSongs.push(event.song));
    const song = media("spotify", "track");
    const { queue } = await harness.distube.play(TARGET, song);
    queue.setAutoplay(true);
    await settle();
    const added = log.length;

    harness.engine.player.finish();
    await settle();

    expect(youtube.related).toHaveBeenCalledTimes(1);
    expect(youtube.related.mock.calls[0]?.[0]).toBe(candidate);
    expect(log.slice(added)).toEqual(events);
    expect(harness.engine.player.playing).toBe(relatedId);
    expect(failedSongs.map(failed => failed === song)).toEqual(relatedId === undefined ? [true] : []);
    await harness.distube.dispose();
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

const PREFETCH = { prefetchAutoplay: true } as const;
const seeds = (source: FakeSource): string[] => source.related.mock.calls.map(([song]) => song.id);
const related = (queue: Pick<DisTubeQueue, "related">) => [queue.related?.song.id, queue.related?.playsNext];

function pendingLookup(source: FakeSource) {
  const lookup = deferred<Song | undefined>();
  const signals: AbortSignal[] = [];
  source.related.mockImplementationOnce((_song, { signal }) => {
    signals.push(signal);
    return lookup.promise;
  });
  return { lookup, signals };
}

describe("autoplay look-ahead", () => {
  it("looks up a related Song for the current Song at item start while items wait and publishes it once", async () => {
    const harness = playableSetup("source", PREFETCH);
    const { lookup } = pendingLookup(harness.source);
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    await queue.add("b");
    await settle();
    const published = updates(harness.distube);

    lookup.resolve(media("source", "related"));
    await settle();

    expect(seeds(harness.source)).toEqual(["a"]);
    expect(harness.source.related.mock.calls[0]?.[1].exclude.map(song => song.id)).toEqual(["a"]);
    expect(published.map(event => [event.state.related?.song.id, event.state.related?.playsNext])).toEqual([
      ["related", false],
    ]);
    expect(related(queue)).toEqual(["related", false]);
  });

  it.each([
    [true, ["a"], "related"],
    [false, [], undefined],
  ] as const)(
    "with prefetchAutoplay %s, turning autoplay on mid-song looks up %j before the item ends",
    async (prefetchAutoplay, expected, held) => {
      const harness = playableSetup("source", prefetchAutoplay ? PREFETCH : {});
      harness.source.related.mockResolvedValue(media("source", "related"));
      const { queue } = await harness.distube.play(TARGET, "a");
      await settle();

      queue.setAutoplay(true);
      const called = seeds(harness.source);
      await settle();

      expect(called).toEqual(expected);
      expect(seeds(harness.source)).toEqual(expected);
      expect(queue.related?.song.id).toBe(held);
    },
  );

  it("keeps the related Song through edits and repeat changes and publishes playsNext on each change", async () => {
    const harness = playableSetup("source", PREFETCH);
    harness.source.related.mockResolvedValueOnce(media("source", "related"));
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    const [b] = await queue.add("b");
    await settle();
    const published = updates(harness.distube);
    const reads = [related(queue)];

    queue.remove(required(b).id);
    reads.push(related(queue));
    queue.setRepeat("song");
    reads.push(related(queue));
    queue.setRepeat("off");
    reads.push(related(queue));
    await settle();

    expect(reads).toEqual([
      ["related", false],
      ["related", true],
      ["related", false],
      ["related", true],
    ]);
    expect(published.map(event => event.state.related?.playsNext)).toEqual([true, false, true]);
    expect(seeds(harness.source)).toEqual(["a"]);
  });

  it("cancels the previous item's lookup at the next item start and keeps the held Song until the new one commits", async () => {
    const harness = playableSetup("source", PREFETCH);
    harness.source.related.mockResolvedValueOnce(media("source", "r"));
    const late = pendingLookup(harness.source);
    const next = pendingLookup(harness.source);
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    queue.setRepeat("song");
    await queue.add("b");
    await settle();
    const player = harness.engine.player;
    player.finish();
    await settle();
    queue.setRepeat("off");
    player.finish();
    await settle();

    late.lookup.resolve(media("source", "r2"));
    await settle();
    const beforeNext = queue.related?.song.id;
    next.lookup.resolve(media("source", "s"));
    await settle();

    expect(seeds(harness.source)).toEqual(["a", "a", "b"]);
    expect(late.signals[0]?.aborted).toBe(true);
    expect([beforeNext, queue.related?.song.id]).toEqual(["r", "s"]);
  });

  it.each([
    ["resolves undefined", (lookup: ReturnType<typeof pendingLookup>["lookup"]) => lookup.resolve(undefined)],
    ["rejects", (lookup: ReturnType<typeof pendingLookup>["lookup"]) => lookup.reject(new Error("radio down"))],
  ])(
    "clears the held Song with one queue.updated and no autoplay failure when the next seed's lookup %s",
    async (_case, settleLookup) => {
      const harness = playableSetup("source", PREFETCH);
      harness.source.related.mockResolvedValueOnce(media("source", "r"));
      const { lookup } = pendingLookup(harness.source);
      const { queue } = await harness.distube.play(TARGET, "a");
      queue.setAutoplay(true);
      await queue.add("b");
      await settle();
      harness.engine.player.finish();
      await settle();
      const published = updates(harness.distube);
      const failures = record(harness.distube, ["queue.autoplay.failed"]);

      settleLookup(lookup);
      await settle();

      expect(seeds(harness.source)).toEqual(["a", "b"]);
      expect(published.map(event => event.state.related)).toEqual([undefined]);
      expect(queue.related).toBeUndefined();
      expect(failures).toEqual([]);
    },
  );

  it.each([
    ["turning autoplay off", (queue: DisTubeQueue) => queue.setAutoplay(false)],
    ["deleting the queue", (queue: DisTubeQueue) => void queue.stop()],
  ])("cancels a pending lookup and drops its result on %s", async (_case, cancel) => {
    const harness = playableSetup("source", PREFETCH);
    harness.source.related.mockResolvedValueOnce(media("source", "r"));
    const { lookup, signals } = pendingLookup(harness.source);
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    await queue.add("b");
    await settle();
    harness.engine.player.finish();
    await settle();
    const published = updates(harness.distube);

    cancel(queue);
    await settle();
    const settledUpdates = published.length;
    lookup.resolve(media("source", "late"));
    await settle();

    expect(signals[0]?.aborted).toBe(true);
    expect(published.at(-1)?.state.related).toBeUndefined();
    expect(published).toHaveLength(settledUpdates);
    expect(queue.related).toBeUndefined();
  });

  it("plays the held Song as a current autoplay item with the seed's metadata and never shows it in upcoming", async () => {
    const harness = playableSetup<unknown>("source", PREFETCH);
    const requester = { member: "user-1" };
    harness.source.related.mockResolvedValueOnce(media("source", "related"));
    const published = updates(harness.distube);
    const added: DisTubeEventMap<unknown>["queue.item.added"][] = [];
    harness.distube.on("queue.item.added", event => void added.push(event));
    const { queue } = await harness.distube.play(TARGET, "a", { metadata: requester });
    queue.setAutoplay(true);
    await settle();
    const before = related(queue);

    harness.engine.player.finish();
    await settle();

    const handOff = required(added.at(-1));
    expect(before).toEqual(["related", true]);
    expect([handOff.item.song.id, handOff.item.autoplay]).toEqual(["related", true]);
    expect(handOff.item.metadata).toBe(requester);
    expect(handOff.state.current).toBe(handOff.item);
    expect([handOff.state.upcoming, handOff.state.related]).toEqual([[], undefined]);
    expect(published.filter(event => event.state.upcoming.some(item => item.song.id === "related"))).toEqual([]);
    expect(harness.engine.player.playing).toBe("related");
    expect(queue.current).toBe(handOff.item);
    expect(seeds(harness.source)).toEqual(["a", "related"]);
  });

  it("asks no related Song for an item added while the related item prepares, once that item fails", async () => {
    const harness = playableSetup("source", PREFETCH);
    harness.source.related.mockResolvedValueOnce(media("source", "related"));
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    await settle();
    const preparation = deferred<PlaybackResource>();
    harness.source.stream.mockReturnValueOnce(preparation.promise);
    harness.engine.player.finish();
    await settle();

    await queue.add("b");
    preparation.reject(new Error("broken"));
    await settle();

    expect(harness.engine.player.playing).toBe("b");
    expect(seeds(harness.source)).toEqual(["a"]);
    expect(queue.related).toBeUndefined();
  });

  it("drops a prefetched autoplay item that failed to prepare and excludes it from later lookups of that seed", async () => {
    const { harness, player } = await autoplaying({ ...PREFETCH, autoplayAttempts: 2 }, { a: ["r1", "r2"] });
    failing(harness.source, ["r1"]);

    player.finish();
    await settle();

    expect(player.played).toEqual(["a", "r2"]);
    expect(harness.source.stream.mock.calls.filter(([song]) => song.id === "r1")).toHaveLength(1);
    expect(lookups(harness.source).map(([seed, exclude]) => [seed, exclude.toSorted()])).toEqual([
      ["a", ["a"]],
      ["a", ["a", "r1"]],
      ["r2", ["a", "r1", "r2"]],
    ]);
  });

  it("drops the Song a failed autoplay item's own lookup holds and asks the seed again", async () => {
    const { harness, queue, player } = await autoplaying(
      { ...PREFETCH, autoplayAttempts: 2 },
      { a: ["r1", "r2"], r1: ["x"] },
    );
    const start = player.gate("play:r1");

    player.finish();
    await start.entered;
    await settle();
    const held = related(queue);
    player.fail(new Error("cannot start"));
    await settle();

    expect(held).toEqual(["x", true]);
    expect(player.played).toEqual(["a", "r1", "r2"]);
    expect(lookups(harness.source).map(([seed]) => seed)).toEqual(["a", "r1", "a", "r2"]);
  });

  it("skips a related item still preparing as current without adding it to history", async () => {
    const harness = playableSetup("source", PREFETCH);
    harness.source.related.mockResolvedValueOnce(media("source", "related"));
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    await settle();
    const signals: AbortSignal[] = [];
    harness.source.stream.mockImplementationOnce(
      (_song, { signal }) =>
        new Promise<never>((_, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    harness.engine.player.finish();
    await settle();
    await queue.add("b");

    const skipped = await queue.skip();
    await settle();

    expect(signals[0]?.aborted).toBe(true);
    expect(skipped?.song.id).toBe("b");
    expect(harness.engine.player.played).toEqual(["a", "b"]);
    expect(queue.history.map(entry => entry.song.id)).toEqual(["a"]);
  });

  it("awaits the ended item's pending lookup and plays its Song without a second lookup for that seed", async () => {
    const harness = playableSetup("source", PREFETCH);
    const { lookup } = pendingLookup(harness.source);
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    await settle();
    const published = updates(harness.distube);

    harness.engine.player.finish();
    await settle();
    const whilePending = [queue.status, queue.current, queue.upcoming];
    lookup.resolve(media("source", "related"));
    await settle();

    expect(whilePending).toEqual(["preparing", undefined, []]);
    expect(published.filter(event => event.state.upcoming.length > 0)).toEqual([]);
    expect(harness.engine.player.playing).toBe("related");
    expect(queue.current?.autoplay).toBe(true);
    expect(seeds(harness.source)).toEqual(["a", "related"]);
  });

  it("cancels the lookup an ended item awaits when an add commits, and plays the added item first", async () => {
    const harness = playableSetup("source", PREFETCH);
    const { lookup, signals } = pendingLookup(harness.source);
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    await settle();
    harness.engine.player.finish();
    await settle();

    await queue.add("b");
    await settle();
    lookup.resolve(media("source", "related"));
    await settle();

    expect(signals[0]?.aborted).toBe(true);
    expect(harness.engine.player.played).toEqual(["a", "b"]);
    expect(queue.related).toBeUndefined();
    expect(waiting(queue)).toEqual([]);
  });

  it("looks up again with the ended Song when the held Song already played", async () => {
    const harness = playableSetup("source", PREFETCH);
    harness.source.related
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(media("source", "related"))
      .mockResolvedValueOnce(media("source", "fresh"));
    const { queue } = await harness.distube.play(TARGET, "related");
    queue.setAutoplay(true);
    await queue.add("a");
    await settle();
    const player = harness.engine.player;
    player.finish();
    await settle();
    const held = related(queue);
    const published = updates(harness.distube);

    player.finish();
    await settle();

    expect(held).toEqual(["related", true]);
    expect(published.filter(event => event.state.upcoming.length > 0)).toEqual([]);
    expect(seeds(harness.source).slice(0, 3)).toEqual(["related", "a", "a"]);
    expect(player.played).toEqual(["related", "a", "fresh"]);
  });

  it("looks up again instead of playing a held age-restricted Song once the queue stops allowing them", async () => {
    const harness = playableSetup("source", PREFETCH);
    const { id, name, url, source } = media("source", "adult");
    harness.source.related
      .mockResolvedValueOnce(new Song({ id, name, url, source, ageRestricted: true }))
      .mockResolvedValueOnce(media("source", "clean"));
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAllowAgeRestricted(true);
    queue.setAutoplay(true);
    await settle();
    const held = related(queue);

    queue.setAllowAgeRestricted(false);
    harness.engine.player.finish();
    await settle();

    expect(held).toEqual(["adult", true]);
    expect(seeds(harness.source)).toEqual(["a", "a", "clean"]);
    expect(harness.source.related).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "a" }),
      expect.objectContaining({ allowAgeRestricted: false }),
    );
    expect(harness.engine.player.played).toEqual(["a", "clean"]);
  });

  it("looks up again when the item's lookup found nothing, and reports the autoplay failure if that finds nothing", async () => {
    const harness = playableSetup("source", PREFETCH);
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    await settle();
    const events = record(harness.distube, ["queue.autoplay.failed", "queue.finished"]);

    harness.engine.player.finish();
    await settle();

    expect(seeds(harness.source)).toEqual(["a", "a"]);
    expect(events).toEqual(["queue.autoplay.failed", "queue.finished"]);
  });

  it("keeps an insertion waiting and holds the lookup's Song as not playing next when the add commits first", async () => {
    const harness = playableSetup("source", PREFETCH);
    const { lookup, signals } = pendingLookup(harness.source);
    const { queue } = await harness.distube.play(TARGET, "a");
    queue.setAutoplay(true);
    await settle();

    await queue.add("b");
    lookup.resolve(media("source", "related"));
    await settle();

    expect(signals[0]?.aborted).toBe(false);
    expect(related(queue)).toEqual(["related", false]);
    expect(waiting(queue)).toEqual(["b"]);
    expect(harness.engine.player.playing).toBe("a");
  });
});

describe("playlist on items", () => {
  it("names the committed Playlist on its items through repeat and previous replays, and none on Song or autoplay items", async () => {
    const harness = playableSetup();
    const playlist = new Playlist({
      id: "list",
      name: "List",
      url: "https://source.example/list",
      source: "source",
      songs: [media("source", "x"), media("source", "y")],
    });
    harness.source.related.mockResolvedValue(media("source", "related"));
    const committed: Playlist[] = [];
    harness.distube.on("queue.playlist.added", event => void committed.push(event.playlist));
    await harness.distube.play(TARGET, "s");
    const queue = required(harness.distube.getQueue(GUILD));
    harness.source.resolve.mockResolvedValueOnce(playlist);
    await queue.add(playlist.url);
    await settle();
    const list = required(committed[0]);
    const player = harness.engine.player;

    expect([queue.current, ...queue.upcoming].map(item => item?.playlist === list)).toEqual([false, true, true]);
    expect("playlist" in required(queue.current)).toBe(false);
    expect(list.songs.map(song => song.id)).toEqual(["x", "y"]);

    player.finish();
    await settle();
    const x = required(queue.current);
    queue.setRepeat("song");
    player.finish();
    await settle();
    expect([queue.current?.song.id, queue.current?.id === x.id, queue.current?.playlist]).toEqual(["x", false, list]);

    queue.setRepeat("off");
    player.finish();
    await settle();
    await queue.previous();
    await settle();
    expect([queue.current?.song.id, queue.current?.playlist]).toEqual(["x", list]);

    queue.setAutoplay(true);
    player.finish();
    await settle();
    player.finish();
    await settle();
    expect([queue.current?.song.id, queue.current?.autoplay]).toEqual(["related", true]);
    expect("playlist" in required(queue.current)).toBe(false);
    await harness.distube.dispose();
  });
});

describe("status", () => {
  it("reads idle before the first insertion commits and preparing after it", async () => {
    const harness = playableSetup();
    const held = deferred<readonly Song[]>();
    harness.source.search.mockReturnValueOnce(held.promise);
    const preparation = deferred<PlaybackResource>();
    harness.source.stream.mockReturnValueOnce(preparation.promise);
    const started = harness.distube.play(TARGET, "a");
    const queue = required(harness.distube.getQueue(GUILD));
    expect(queue.status).toBe("idle");

    held.resolve([media("source", "a")]);
    await started;
    await settle();

    expect([queue.status, queue.current, queue.upcoming.map(item => item.song.id)]).toEqual([
      "preparing",
      undefined,
      ["a"],
    ]);
    preparation.resolve(harness.source.resource("a"));
    await harness.distube.dispose();
  });

  it("reads preparing during an autoplay lookup, and idle in the same commit that turns autoplay off", async () => {
    const { harness, queue, player } = await playing(["a"]);
    harness.source.related.mockReturnValueOnce(new Promise<never>(() => undefined));
    queue.setAutoplay(true);
    await settle();
    const published = updates(harness.distube);

    player.finish();
    await settle();
    expect([queue.status, queue.current, queue.upcoming]).toEqual(["preparing", undefined, []]);

    queue.setAutoplay(false);
    expect(queue.status).toBe("idle");
    await settle();
    expect(published.map(event => [event.state.status, event.state.autoplay])).toEqual([
      ["preparing", true],
      ["idle", false],
    ]);
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
    const first = required((await queue.add(song, { allowAgeRestricted: true }))[0]);
    const second = required((await queue.add(song, { allowAgeRestricted: true }))[0]);
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

    expect(player.renders.length).toBe(rendered);
    expect(voice.volume).toBe(40);
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 15, label: "Bass boost" }]);
    expect([queue.repeat, queue.autoplay, queue.history]).toEqual(["off", false, []]);

    const { queue: replacement } = await harness.distube.play(TARGET, "b");
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
