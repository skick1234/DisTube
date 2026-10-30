import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { DisTubeError, type ErrorCode, type QueueState, Song } from "../src";
import type { PlaybackResource, Plugin, TrackEnd } from "../src/integrations";
import {
  capture,
  deferred,
  type FakeEngine,
  FakePlayer,
  FakeSource,
  GUILD,
  media,
  mediaUrl,
  playableSetup,
  PreparingEngine,
  record,
  required,
  settle,
  setup,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

/** Installs the next Player the engine hands out, so a test controls it before the first activation. */
function armPlayer(engine: FakeEngine, arm: (player: FakePlayer) => void): FakePlayer {
  const player = new FakePlayer();
  arm(player);
  engine.createPlayer.mockImplementationOnce(async () => {
    engine.players.push(player);
    return player;
  });
  return player;
}

/** A `url` resource with a spy disposer, for tests that assert cleanup exactly once. */
function prepared(url: string): { resource: PlaybackResource; dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  return { resource: { kind: "url", url, dispose }, dispose };
}

describe("enqueue commitment", () => {
  it("advances the commit cursor past an earlier resolution failure", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "seed");
    await settle();
    const first = deferred<Song>();
    const second = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const failed = capture(queue.add(mediaUrl("first")));
    const succeeds = queue.add(mediaUrl("second"));

    second.resolve(media("source", "second"));
    first.reject(new Error("first failed"));

    expect(await failed).toMatchObject({ code: "SOURCE_FAILED" });
    const [item] = await succeeds;
    expect(queue.upcoming[0] ?? queue.current).toBe(item);
  });

  it("rejects a ready enqueue after a listener stops the queue", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "seed");
    await settle();
    const first = deferred<Song>();
    const second = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const events: string[] = [];
    let stopping: Promise<void> | undefined;
    harness.distube.on("queue.item.added", event => {
      events.push(`added:${event.item.song.id}`);
      if (event.item.song.id === "first") stopping = event.queue.stop();
    });
    harness.distube.on("queue.deleted", () => events.push("deleted"));

    const firstEnqueue = queue.add(mediaUrl("first"));
    const secondEnqueue = capture(queue.add(mediaUrl("second")));
    second.resolve(media("source", "second"));
    first.resolve(media("source", "first"));

    await expect(firstEnqueue).resolves.toHaveLength(1);
    expect(await secondEnqueue).toMatchObject({ code: "INVALID_STATE" });
    expect(stopping).toBeDefined();
    await stopping;
    expect(events).toEqual(["added:first", "deleted"]);
  });
});

describe("playback preparation", () => {
  it("plays a freshly prepared URL rather than the canonical Song URL, and disposes it at the end", async () => {
    const source = new FakeSource("youtube");
    const song = media("youtube");
    const { resource, dispose } = prepared("https://stream.example/fresh");
    source.stream.mockResolvedValue(resource);
    const harness = setup([source]);

    await harness.distube.play(TARGET, song);
    await settle();
    const player = harness.engine.player;

    expect(player.play).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://stream.example/fresh" }),
      expect.anything(),
    );
    expect(source.stream.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(dispose).not.toHaveBeenCalled();

    player.finish();
    await settle();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reports a disposal failure after the end diagnostically without rewriting item history", async () => {
    const source = new FakeSource("source");
    const dispose = vi.fn(async () => {
      throw new Error("dispose failed");
    });
    source.stream.mockResolvedValue({ kind: "url", url: "https://stream.example/disposal", dispose });
    const harness = setup([source]);
    const finished = vi.fn();
    const failed = vi.fn();
    harness.distube.on("queue.item.finished", finished);
    harness.distube.on("queue.item.failed", failed);

    await harness.distube.play(TARGET, media("source"));
    await settle();
    harness.engine.player.finish();
    await settle();

    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics).toHaveBeenCalledWith(expect.objectContaining({ stage: "voice.resource.dispose" }));
  });
});

describe("stream-only and failing sources", () => {
  it("plays a Song from a plugin that has only stream, destroys its stream once and deletes the queue", async () => {
    const clip = { kind: "stream", stream: Readable.from(["audio"]), dispose: vi.fn() } satisfies PlaybackResource;
    const clips: Plugin = { name: "clips", stream: vi.fn(async () => clip) };
    const harness = setup([clips]);
    const song = new Song({ source: "clips", id: "airhorn", name: "Airhorn", url: "https://clips.example/airhorn" });
    const events: string[] = [];
    harness.distube.on("queue.item.finished", event => void events.push(`finished:${event.item.song.id}`));
    harness.distube.on("queue.deleted", event => void events.push(`deleted:${event.reason}`));

    const { queue } = await harness.distube.play(TARGET, song);
    await settle();
    expect(queue.current?.song).toBe(song);
    expect(harness.engine.player.play).toHaveBeenCalledWith(clip, expect.anything());
    harness.engine.player.finish();
    await settle();

    expect(events).toEqual(["finished:airhorn", "deleted:finished"]);
    expect(clip.stream.destroyed).toBe(true);
    expect(clip.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a DisTubeError", new DisTubeError("UNAVAILABLE", "region locked"), "UNAVAILABLE"],
    ["a plain Error", new Error("provider failed"), "SOURCE_FAILED"],
  ] as const)(
    "fails the item when the owner's stream rejects with %s and consults no other plugin",
    async (_kind, failure, code) => {
      const original = new FakeSource("original");
      const other = new FakeSource("other");
      original.stream.mockRejectedValueOnce(failure);
      const harness = setup([original, other]);
      const failures: ErrorCode[] = [];
      harness.distube.on("queue.item.failed", event => failures.push(event.error.code));

      await harness.distube.play(TARGET, media("original", "provider-failure"));
      await settle();

      expect(failures).toEqual([code]);
      expect(other.search).not.toHaveBeenCalled();
      expect(other.stream).not.toHaveBeenCalled();
    },
  );
});

const spotify: Plugin = { name: "spotify", resolve: async () => undefined };

function spotifySong(artist?: string): Song {
  return new Song({
    source: "spotify",
    id: "track",
    name: "Song A",
    url: "https://open.spotify.com/track/track",
    ...(artist === undefined ? {} : { artist }),
  });
}

describe("search fallback for a plugin without stream", () => {
  it("plays the next plugin's first candidate under the original item when the first plugin's candidate fails", async () => {
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    youtube.search.mockResolvedValue([media("youtube", "yt-first"), media("youtube", "yt-second")]);
    youtube.stream.mockRejectedValue(new Error("unplayable"));
    const candidate = media("soundcloud", "sc-first");
    soundcloud.search.mockResolvedValue([candidate]);
    const harness = setup([spotify, youtube, soundcloud]);
    const started: unknown[] = [];
    const fallbacks: unknown[] = [];
    harness.distube.on("queue.item.started", event => {
      started.push(event.item);
      fallbacks.push(event.fallback);
    });

    const song = spotifySong("Artist B");
    const { queue } = await harness.distube.play(TARGET, song);
    await settle();
    const first = queue.current;
    await queue.add(media("soundcloud", "own-stream"));
    await queue.skip();
    await settle();

    expect(youtube.stream.mock.calls.map(([found]) => found.id)).toEqual(["yt-first"]);
    expect(harness.engine.player.played).toEqual(["sc-first", "own-stream"]);
    expect(started[0]).toBe(first);
    expect(first?.song).toBe(song);
    expect(fallbacks).toEqual([candidate, undefined]);
    expect(fallbacks[0]).toBe(candidate);
    await harness.distube.dispose();
  });

  it.each([
    ["Artist B Artist C", "Song A Artist B Artist C"],
    [undefined, "Song A"],
  ])("searches with the name and artist %j as %j and limit 1", async (artist, query) => {
    const youtube = new FakeSource("youtube");
    youtube.search.mockResolvedValue([media("youtube", "yt-first")]);
    const harness = setup([spotify, youtube]);

    await harness.distube.play(TARGET, spotifySong(artist));
    await settle();

    expect(youtube.search).toHaveBeenCalledWith(query, expect.objectContaining({ limit: 1, offset: 0 }));
    expect(harness.engine.player.played).toEqual(["yt-first"]);
    await harness.distube.dispose();
  });

  it("fails the item NO_RESULT when no plugin finds a candidate and advances the queue", async () => {
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    const harness = setup([spotify, youtube, soundcloud]);
    const failures: [ErrorCode, string | undefined][] = [];
    harness.distube.on("queue.item.failed", event => void failures.push([event.error.code, event.error.query]));

    const { queue } = await harness.distube.play(TARGET, spotifySong("Artist B"));
    await queue.add(media("youtube", "after"));
    await settle();

    expect(failures).toEqual([["NO_RESULT", "Song A Artist B"]]);
    expect(youtube.stream.mock.calls.map(([song]) => song.id)).toEqual(["after"]);
    expect(soundcloud.stream).not.toHaveBeenCalled();
    expect(harness.engine.player.played).toEqual(["after"]);
    await harness.distube.dispose();
  });

  it("fails the item SOURCE_FAILED with every plugin's failure when no candidate prepares", async () => {
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    const streamFailure = new Error("unplayable");
    const searchFailure = new Error("search down");
    youtube.search.mockResolvedValue([media("youtube", "yt-first")]);
    youtube.stream.mockRejectedValue(streamFailure);
    soundcloud.search.mockRejectedValue(searchFailure);
    const harness = setup([spotify, youtube, soundcloud]);
    const errors: DisTubeError[] = [];
    harness.distube.on("queue.item.failed", event => void errors.push(event.error));

    await harness.distube.play(TARGET, spotifySong());
    await settle();

    expect(errors.map(error => [error.code, error.query])).toEqual([["SOURCE_FAILED", "Song A"]]);
    const cause = errors[0]?.cause;
    expect(cause).toBeInstanceOf(AggregateError);
    expect((cause as AggregateError).errors.map(error => (error as Error).cause)).toEqual([
      streamFailure,
      searchFailure,
    ]);
    await harness.distube.dispose();
  });

  it.each([
    ["every candidate's service", ["youtube", "soundcloud"], undefined],
    ["the one service that answered", ["youtube"], "youtube"],
  ] as const)(
    "fails the item with the code every candidate shares and the source of %s",
    async (_case, names, source) => {
      const plugins = names.map(name => {
        const plugin = new FakeSource(name);
        plugin.search.mockResolvedValue([media(name, `${name}-first`)]);
        plugin.stream.mockRejectedValue(new DisTubeError("RATE_LIMITED", "slow down", { source: name }));
        return plugin;
      });
      const harness = setup([spotify, ...plugins]);
      const errors: DisTubeError[] = [];
      harness.distube.on("queue.item.failed", event => void errors.push(event.error));

      await harness.distube.play(TARGET, spotifySong());
      await settle();

      expect(errors.map(error => [error.code, error.source, error.query])).toEqual([
        ["RATE_LIMITED", source, "Song A"],
      ]);
      const causes = (required(errors[0]).cause as AggregateError).errors as DisTubeError[];
      expect(causes.map(cause => cause.source)).toEqual(names);
      await harness.distube.dispose();
    },
  );
});

describe("status between items", () => {
  it("reads preparing while the next item's stream is pending and from its hand-off until it is audible", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    const queue = required(harness.distube.getQueue(GUILD));
    await queue.add("b");
    await settle();
    const player = harness.engine.player;
    const preparation = deferred<PlaybackResource>();
    harness.source.stream.mockImplementationOnce(() => preparation.promise);
    const audible = player.gate("play:b");

    player.finish();
    await settle();
    expect([queue.status, queue.current, queue.upcoming[0]?.song.id]).toEqual(["preparing", undefined, "b"]);

    preparation.resolve(harness.source.resource("b"));
    await audible.entered;
    expect([queue.status, queue.current?.song.id, queue.position]).toEqual(["preparing", "b", 0]);

    audible.resolve();
    await settle();
    expect([queue.status, queue.current?.song.id]).toEqual(["playing", "b"]);
    await harness.distube.dispose();
  });

  it("publishes no idle status between a finished item and the next one's start", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    const queue = required(harness.distube.getQueue(GUILD));
    await queue.add("b");
    await settle();
    const statuses: string[] = [];
    for (const name of ["queue.item.finished", "queue.updated", "queue.item.started"] as const)
      harness.distube.on(name, event => void statuses.push(`${name}:${event.state.status}`));

    harness.engine.player.finish();
    await settle();

    expect(statuses).toEqual([
      "queue.item.finished:preparing",
      "queue.updated:preparing",
      "queue.updated:preparing",
      "queue.item.started:playing",
      "queue.updated:playing",
    ]);
    await harness.distube.dispose();
  });

  it("follows queue.item.finished with an update from the same commit whose history holds the finished item", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    const queue = required(harness.distube.getQueue(GUILD));
    await queue.add("b");
    await settle();
    const a = required(queue.current);
    const published: { name: string; state: QueueState; timestamp: number }[] = [];
    for (const name of ["queue.item.finished", "queue.updated"] as const)
      harness.distube.on(name, ({ state, timestamp }) => void published.push({ name, state, timestamp }));

    harness.engine.player.finish();
    await settle();

    const [finished, update] = published;
    expect(published.map(event => event.name).slice(0, 2)).toEqual(["queue.item.finished", "queue.updated"]);
    expect(update?.state).toBe(finished?.state);
    expect(update?.timestamp).toBe(finished?.timestamp);
    expect(finished?.state.history.map(item => item.id)).toEqual([a.id]);
    await harness.distube.dispose();
  });
});

function remote(engine = new PreparingEngine()): Plugin & { readonly engine: PreparingEngine } {
  return { name: "remote", engine };
}

describe("engine preparation", () => {
  it("prepares every Song through the engine, never calls the owner's stream and publishes the original item", async () => {
    const source = new FakeSource("source");
    const plugin = remote();
    const harness = setup([source, plugin]);
    const started: unknown[] = [];
    harness.distube.on("queue.item.started", event => void started.push(event.item));

    const { queue } = await harness.distube.play(TARGET, media("source", "first"));
    const first = queue.current ?? queue.upcoming[0];
    await queue.add(media("source", "second"));
    await settle();
    plugin.engine.player.finish();
    await settle();

    expect(plugin.engine.prepare.mock.calls.map(([song]) => song.id)).toEqual(["first", "second"]);
    expect(source.stream).not.toHaveBeenCalled();
    expect(plugin.engine.player.played).toEqual(["encoded", "encoded"]);
    expect(started[0]).toBe(first);
    expect(queue.current?.song.source).toBe("source");
    await harness.distube.dispose();
  });

  it("aborts the prepare signal once the item stops being next", async () => {
    const plugin = remote();
    let signal: AbortSignal | undefined;
    plugin.engine.prepare.mockImplementationOnce(async (_song, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", reject));
    });
    const source = new FakeSource("source");
    const harness = setup([source, plugin]);
    const { queue } = await harness.distube.play(TARGET, media("source", "slow"));
    await settle();

    await queue.add(media("source", "urgent"), { next: true });
    expect(signal?.aborted).toBe(true);
    await settle();
    expect(plugin.engine.player.played).toEqual(["encoded"]);
    expect(queue.current?.song.id).toBe("urgent");
    expect(queue.upcoming.map(item => item.song.id)).toEqual(["slow"]);
    await harness.distube.dispose();
  });
});

describe("terminal authority", () => {
  it("clears logical state at once and hands the guild to a fresh queue", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();

    const stopping = queue.stop();
    expect(queue.upcoming).toEqual([]);
    expect(queue.current).toBeUndefined();
    expect(queue.voice).toBeUndefined();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    await stopping;
    expect(harness.engine.player.playing).toBeUndefined();

    const { queue: second } = await harness.distube.play(TARGET, "b");
    // Queues have no public ID; a fresh queue is a different facade object.
    expect(second).not.toBe(queue);
  });

  it("waits for a Player activation accepted before deletion, then disposes it exactly once", async () => {
    const harness = playableSetup();
    const { resource, dispose } = prepared("https://stream.example/late-player");
    harness.source.stream.mockResolvedValue(resource);
    const activation = deferred<TrackEnd>();
    armPlayer(harness.engine, player => player.play.mockReturnValueOnce(activation.promise));
    const started = vi.fn();
    harness.distube.on("queue.item.started", started);
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();

    let settled = false;
    const stopping = queue.stop().finally(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);
    activation.resolve({ reason: "stopped" });
    await stopping;

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(started).not.toHaveBeenCalled();
    expect(queue.current).toBeUndefined();
  });

  it.each(["skip", "jump", "stop"] as const)(
    "%s settles while the voice's Player is still being created, and the voice keeps the late Player",
    async command => {
      const harness = playableSetup();
      const creation = harness.engine.gateCreate();
      const { queue } = await harness.distube.play(TARGET, "a");
      await queue.add("b");
      await settle();

      const end = { skip: () => queue.skip(), jump: () => queue.jump(1), stop: () => queue.stop() }[command];
      let settled = false;
      const ending = end().finally(() => {
        settled = true;
      });
      await settle();
      expect(settled).toBe(true);
      expect(harness.source.disposed).toEqual(["a"]);

      const late = new FakePlayer();
      creation.resolve(late);
      await ending;
      if (command === "stop") await harness.distube.play(TARGET, "c");
      await settle();

      expect(late.played).toEqual([command === "stop" ? "c" : "b"]);
      expect(late.release).not.toHaveBeenCalled();
      expect(harness.engine.createPlayer).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["skip", "jump"] as const)(
    "after %s, the next item creates its own Player when the creation started for the ended item fails",
    async command => {
      const harness = playableSetup();
      const creation = harness.engine.gateCreate();
      const failed = record(harness.distube, ["queue.item.failed"]);
      const { queue } = await harness.distube.play(TARGET, "a");
      await queue.add("b");
      await queue.add("c");
      await settle();

      await (command === "skip" ? queue.skip() : queue.jump(1));
      await settle();
      creation.reject(new Error("engine down"));
      await settle();

      expect(failed).toEqual([]);
      expect(queue.current?.song.id).toBe("b");
      expect(harness.engine.player.playing).toBe("b");
      expect(harness.engine.createPlayer).toHaveBeenCalledTimes(2);
      await harness.distube.dispose();
    },
  );

  it("settles only once the active resource has finished disposing", async () => {
    const harness = playableSetup();
    const disposal = deferred<void>();
    const dispose = vi.fn(() => disposal.promise);
    harness.source.stream.mockResolvedValue({ kind: "url", url: "https://stream.example/slow", dispose });
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();

    let settled = false;
    const stopping = queue.stop().finally(() => {
      settled = true;
    });
    await settle();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    disposal.resolve();
    await stopping;
    expect(settled).toBe(true);
  });
});
