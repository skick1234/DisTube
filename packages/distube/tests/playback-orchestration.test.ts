import { describe, expect, it, vi } from "vitest";
import type { ErrorCode, Song } from "../src";
import type { PlaybackPreparation, Player, Plugin, PrepareContext, TrackEnd } from "../src/integrations";
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

/** A `resource` preparation with a spy disposer, for tests that assert cleanup exactly once. */
function prepared(url: string): { preparation: PlaybackPreparation; dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  return { preparation: { kind: "resource", resource: { kind: "url", url, dispose } }, dispose };
}

describe("enqueue commitment", () => {
  it("advances the commit cursor past an earlier resolution failure", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "seed");
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
    const queue = await harness.distube.play(TARGET, "seed");
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
    const { preparation, dispose } = prepared("https://stream.example/fresh");
    source.stream.mockResolvedValue(preparation);
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
    source.stream.mockResolvedValue({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/disposal", dispose },
    });
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

describe("search fallback", () => {
  it("prepares the first candidate of the other plugins in order and keeps the original item", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    const original = media("spotify", "original");
    spotify.stream.mockResolvedValue({ kind: "search", query: "Title Artist" });
    youtube.search.mockResolvedValue([media("youtube", "first"), media("youtube", "second")]);
    youtube.stream.mockRejectedValue(new Error("youtube cannot prepare"));
    soundcloud.search.mockResolvedValue([media("soundcloud", "candidate")]);
    const harness = setup([spotify, youtube, soundcloud]);
    const started = vi.fn();
    harness.distube.on("queue.item.started", event => started(event.item));

    const queue = await harness.distube.play(TARGET, original);
    const [item] = queue.upcoming;
    await settle();

    expect(youtube.search).toHaveBeenCalledWith("Title Artist", expect.objectContaining({ limit: 1, offset: 0 }));
    expect(youtube.stream.mock.calls.map(([song]) => song.id)).toEqual(["first"]);
    expect(soundcloud.stream.mock.calls.map(([song]) => song.id)).toEqual(["candidate"]);
    expect(harness.engine.player.played).toEqual(["candidate"]);
    expect(started).toHaveBeenCalledExactlyOnceWith(item);
    expect(queue.current?.song).toBe(original);
    expect(spotify.search).not.toHaveBeenCalled();
  });

  it("treats a candidate that requests search again as unsuccessful, without a nested search", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    spotify.stream.mockResolvedValue({ kind: "search", query: "first query" });
    youtube.search.mockResolvedValue([media("youtube", "candidate")]);
    youtube.stream.mockResolvedValue({ kind: "search", query: "nested query" });
    soundcloud.search.mockResolvedValue([media("soundcloud", "nested")]);
    const harness = setup([spotify, youtube, soundcloud]);

    await harness.distube.play(TARGET, media("spotify", "original"));
    await settle();

    expect(soundcloud.search).toHaveBeenCalledWith("first query", expect.anything());
    expect(youtube.search).toHaveBeenCalledTimes(1);
    expect(harness.engine.player.played).toEqual(["nested"]);
  });

  it("fails an exhausted fallback NO_RESULT, or SOURCE_FAILED with every failure in order", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    spotify.stream.mockResolvedValue({ kind: "search", query: "query" });
    const harness = setup([spotify, youtube, soundcloud]);
    const failures: unknown[] = [];
    harness.distube.on("queue.item.failed", event => failures.push(event.error));

    await harness.distube.play(TARGET, media("spotify", "nothing"));
    await settle();
    expect(failures[0]).toMatchObject({ code: "NO_RESULT" });

    const searchFailure = new Error("youtube search");
    const prepareFailure = new Error("soundcloud prepare");
    youtube.search.mockRejectedValue(searchFailure);
    soundcloud.search.mockResolvedValue([media("soundcloud", "candidate")]);
    soundcloud.stream.mockRejectedValue(prepareFailure);
    await harness.distube.play(TARGET, media("spotify", "failing"));
    await settle();
    expect(failures[1]).toMatchObject({ code: "SOURCE_FAILED", cause: expect.any(AggregateError) });
    const causes = ((failures[1] as Error).cause as AggregateError).errors;
    expect(causes).toMatchObject([{ cause: searchFailure }, { cause: prepareFailure }]);
  });

  it("rejects a candidate whose source is not the searching plugin", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    spotify.stream.mockResolvedValue({ kind: "search", query: "query" });
    youtube.search.mockResolvedValue([media("spotify", "wrong-owner")]);
    const harness = setup([spotify, youtube]);
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", event => failed(event.error.code));

    await harness.distube.play(TARGET, media("spotify", "original"));
    await settle();

    expect(youtube.stream).not.toHaveBeenCalled();
    expect(spotify.stream).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith("SOURCE_FAILED");
  });

  it("never falls back when the owning plugin itself fails to prepare", async () => {
    const original = new FakeSource("original");
    const other = new FakeSource("other");
    original.stream.mockRejectedValueOnce(new Error("provider failed"));
    const harness = setup([original, other]);
    const failures: ErrorCode[] = [];
    harness.distube.on("queue.item.failed", event => failures.push(event.error.code));

    await harness.distube.play(TARGET, media("original", "provider-failure"));
    await settle();

    expect(failures).toEqual(["SOURCE_FAILED"]);
    expect(other.search).not.toHaveBeenCalled();
  });

  it("never falls back when the Player rejects the start, and disposes the prepared resource", async () => {
    const original = new FakeSource("original");
    const other = new FakeSource("other");
    const { preparation, dispose } = prepared("https://stream.example/failure");
    original.stream.mockResolvedValueOnce(preparation);
    const harness = setup([original, other]);
    armPlayer(harness.engine, player => player.play.mockRejectedValueOnce(new Error("voice failed")));
    const failures: ErrorCode[] = [];
    harness.distube.on("queue.item.failed", event => failures.push(event.error.code));

    await capture(harness.distube.play(TARGET, media("original", "player-failure")));
    await settle();

    expect(failures).toEqual(["VOICE_FAILED"]);
    expect(other.search).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

function remote(engine = new PreparingEngine()): Plugin & { readonly engine: PreparingEngine } {
  return { name: "remote", engine };
}

describe("engine preparation", () => {
  it("prepares every Song through the engine and calls the owner's stream only when asked", async () => {
    const source = new FakeSource("source");
    const plugin = remote();
    const contexts: PrepareContext[] = [];
    plugin.engine.prepare.mockImplementation(async (song, context) => {
      contexts.push(context);
      const preparation = song.id === "lazy" ? await context.stream?.() : undefined;
      return preparation?.kind === "resource"
        ? preparation.resource
        : { kind: "encoded", format: "fake", encoded: song.id };
    });
    const harness = setup([source, plugin]);

    const queue = await harness.distube.play(TARGET, media("source", "native"));
    await queue.add(media("source", "lazy"));
    await settle();
    expect(source.stream).not.toHaveBeenCalled();
    expect(contexts[0]?.stream).toBeTypeOf("function");

    plugin.engine.player.finish();
    await settle();
    expect(source.stream.mock.calls.map(([song]) => song.id)).toEqual(["lazy"]);
    expect(plugin.engine.player.played).toEqual(["encoded", "lazy"]);
    await harness.distube.dispose();
  });

  it("offers no stream callback for a Song owned by the engine plugin or by a plugin without stream", async () => {
    const plugin: Plugin & { readonly engine: PreparingEngine } = {
      name: "remote",
      engine: new PreparingEngine(),
      search: async query => [media("remote", query)],
      stream: vi.fn(async (song: Song): Promise<PlaybackPreparation> => new FakeSource("remote").resourceFor(song)),
    };
    const streamless: Plugin = { name: "streamless", resolve: async () => undefined };
    const harness = setup([plugin, streamless]);

    const queue = await harness.distube.play(TARGET, media("remote", "own"));
    await queue.add(media("streamless", "bare"));
    await settle();
    plugin.engine.player.finish();
    await settle();

    expect(plugin.engine.prepare.mock.calls.map(([song, context]) => [song.id, context.stream])).toEqual([
      ["own", undefined],
      ["bare", undefined],
    ]);
    await harness.distube.dispose();
  });

  it("aborts the prepare signal once the item stops being next", async () => {
    const plugin = remote();
    let signal: AbortSignal | undefined;
    plugin.engine.prepare.mockImplementationOnce(async (_song, context) => {
      signal = context.signal;
      return new Promise((_resolve, reject) => context.signal.addEventListener("abort", reject));
    });
    const source = new FakeSource("source");
    const harness = setup([source, plugin]);
    const queue = await harness.distube.play(TARGET, media("source", "slow"));
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
    const queue = await harness.distube.play(TARGET, "a");
    await settle();

    const stopping = queue.stop();
    expect(queue.upcoming).toEqual([]);
    expect(queue.current).toBeUndefined();
    expect(queue.voice).toBeUndefined();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    await stopping;
    expect(harness.engine.player.playing).toBeUndefined();

    const second = await harness.distube.play(TARGET, "b");
    // Queues have no public ID; a fresh queue is a different facade object.
    expect(second).not.toBe(queue);
  });

  it("waits for a Player activation accepted before deletion, then disposes it exactly once", async () => {
    const harness = playableSetup();
    const { preparation, dispose } = prepared("https://stream.example/late-player");
    harness.source.stream.mockResolvedValue(preparation);
    const activation = deferred<TrackEnd>();
    armPlayer(harness.engine, player => player.play.mockReturnValueOnce(activation.promise));
    const started = vi.fn();
    harness.distube.on("queue.item.started", started);
    const call = harness.distube.play(TARGET, "a");
    const queue = await call;
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

  it("waits for a Player created before deletion and keeps it free of queue effects", async () => {
    const harness = playableSetup();
    const creation = deferred<Player>();
    const late = new FakePlayer();
    harness.engine.createPlayer.mockReturnValueOnce(creation.promise);
    const call = harness.distube.play(TARGET, "a");
    const queue = await call;
    await settle();

    let settled = false;
    const stopping = queue.stop().finally(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);
    creation.resolve(late);
    await stopping;

    // The Player belongs to the DisTubeVoice, so the deleted queue leaves it ready for the next queue.
    expect(late.played).toEqual([]);
    expect(late.release).not.toHaveBeenCalled();
    expect(queue.current).toBeUndefined();
  });

  it("aborts preparation for a removed item and disposes its late resource once", async () => {
    const harness = playableSetup();
    const preparation = deferred<PlaybackPreparation>();
    let signal: AbortSignal | undefined;
    harness.source.stream.mockImplementation(async (_song, context) => {
      signal = context.signal;
      return preparation.promise;
    });
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", failed);
    const queue = await harness.distube.play(TARGET, "selected");
    const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
    await settle();

    await queue.remove(items[0]?.id as string);
    expect(queue.upcoming.some(item => item.id === items[0]?.id)).toBe(false);
    expect(signal?.aborted).toBe(true);
    const { preparation: late, dispose } = prepared("https://stream.example/late");
    preparation.resolve(late);
    await settle();

    expect(dispose).toHaveBeenCalledTimes(1);
    // The voice creates its Player on the first accepted play, and no play was ever accepted.
    expect(harness.engine.players.flatMap(player => player.played)).toEqual([]);
    expect(failed).not.toHaveBeenCalled();
  });

  it("settles only once the active resource has finished disposing", async () => {
    const harness = playableSetup();
    const disposal = deferred<void>();
    const dispose = vi.fn(() => disposal.promise);
    harness.source.stream.mockResolvedValue({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/slow", dispose },
    });
    const queue = await harness.distube.play(TARGET, "a");
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
