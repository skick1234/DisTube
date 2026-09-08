import { describe, expect, it, vi } from "vitest";
import type { ErrorCode, Song } from "../src";
import type { PlaybackPreparation, PlaybackRequest, Player } from "../src/integrations";
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

/** Narrows a recorded request to the URL resource kind these fakes always produce. */
function requestUrl(request: PlaybackRequest | undefined): string | undefined {
  return request?.resource.kind === "url" ? request.resource.url : undefined;
}

/** A `resource` preparation with a spy disposer, for tests that assert cleanup exactly once. */
function prepared(url: string): { preparation: PlaybackPreparation; dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  return { preparation: { kind: "resource", resource: { kind: "url", url, dispose } }, dispose };
}

describe("enqueue commitment", () => {
  it("advances the commit cursor past an earlier resolution failure", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "seed");
    await settle();
    const first = deferred<Song>();
    const second = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const failed = capture(queue.enqueue(mediaUrl("first")));
    const succeeds = queue.enqueue(mediaUrl("second"));

    second.resolve(media("source", "second"));
    first.reject(new Error("first failed"));

    expect(await failed).toMatchObject({ code: "SOURCE_FAILED" });
    const [item] = await succeeds;
    expect(queue.state.upcoming[0] ?? queue.state.current).toBe(item);
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

    const firstEnqueue = queue.enqueue(mediaUrl("first"));
    const secondEnqueue = capture(queue.enqueue(mediaUrl("second")));
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
    const { preparation, dispose } = prepared("https://stream.example/fresh?signature=private");
    source.preparePlayback.mockResolvedValue(preparation);
    const harness = setup([source]);

    const { items } = await harness.distube.play(TARGET, song);
    await settle();
    const player = harness.engine.players[0] as FakePlayer;

    expect(player.requests[0]).toEqual({
      itemId: items[0]?.id,
      resource: expect.objectContaining({ url: "https://stream.example/fresh?signature=private" }),
    });
    expect(requestUrl(player.requests[0])).not.toBe(song.url);
    expect(source.preparePlayback.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);

    player.finish();
    await settle();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes a malformed resource once and keeps its URL out of the public error", async () => {
    const source = new FakeSource("source");
    const secret = "file:///private/audio?token=secret";
    const dispose = vi.fn();
    source.preparePlayback.mockResolvedValue({ kind: "resource", resource: { kind: "url", url: secret, dispose } });
    const harness = setup([source]);
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", failed);

    await harness.distube.play(TARGET, media("source"));
    await settle();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0]?.[0].error).toMatchObject({ code: "SOURCE_FAILED" });
    expect(failed.mock.calls[0]?.[0].error.message).not.toContain(secret);
  });

  it("reports a post-terminal disposal failure diagnostically without rewriting item history", async () => {
    const source = new FakeSource("source");
    const dispose = vi.fn(async () => {
      throw new Error("dispose failed");
    });
    source.preparePlayback.mockResolvedValue({
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
    (harness.engine.players[0] as FakePlayer).finish();
    await settle();

    expect(finished).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics).toHaveBeenCalled();
  });

  it("rejects terminal cleanup when stop overlaps an outcome disposal", async () => {
    const harness = playableSetup();
    const disposal = deferred<void>();
    const disposalError = new Error("dispose failed");
    const dispose = vi.fn(() => disposal.promise);
    harness.source.preparePlayback.mockResolvedValue({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/disposal", dispose },
    });
    const deleted = vi.fn();
    harness.distube.on("queue.deleted", deleted);
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();

    (harness.engine.players[0] as FakePlayer).finish();
    await settle();
    expect(dispose).toHaveBeenCalledTimes(1);

    let settled = false;
    const stopping = queue.stop().finally(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);

    disposal.reject(disposalError);
    await expect(stopping).rejects.toMatchObject({ code: "VOICE_FAILED", cause: disposalError });
    expect(deleted).toHaveBeenCalledTimes(1);
  });
});

describe("explicit fallback", () => {
  it("searches the other sources in configured order and keeps the original item identity", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    const original = media("spotify", "original");
    spotify.preparePlayback.mockResolvedValue({ kind: "search", query: "Title Artist One Artist Two" });
    soundcloud.search.mockResolvedValue([media("soundcloud", "candidate")]);
    const harness = setup([spotify, youtube, soundcloud]);
    const started = vi.fn();
    harness.distube.on("queue.item.started", started);

    const { items } = await harness.distube.play(TARGET, original);
    await settle();
    const player = harness.engine.players[0] as FakePlayer;

    expect(youtube.search).toHaveBeenCalledWith(
      "Title Artist One Artist Two",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(soundcloud.search).toHaveBeenCalledWith("Title Artist One Artist Two", expect.anything());
    expect(soundcloud.preparePlayback.mock.calls[0]?.[0].id).toBe("candidate");
    expect(player.requests[0]?.itemId).toBe(items[0]?.id);
    expect(requestUrl(player.requests[0])).toBe("https://stream.example/candidate");
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ item: items[0] }));
    // The item still carries the Song the caller asked for; only the stream came from elsewhere.
    expect(harness.distube.getQueue(GUILD)?.state.current?.song).toBe(original);
  });

  it("follows one nested fallback without revisiting a source", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    spotify.preparePlayback.mockResolvedValue({ kind: "search", query: "first query" });
    youtube.search.mockResolvedValue([media("youtube", "candidate")]);
    youtube.preparePlayback.mockResolvedValue({ kind: "search", query: "nested query" });
    soundcloud.search.mockResolvedValue([media("soundcloud", "nested")]);
    const harness = setup([spotify, youtube, soundcloud]);

    await harness.distube.play(TARGET, media("spotify", "original"));
    await settle();

    expect(soundcloud.search).toHaveBeenCalledWith("nested query", expect.anything());
    expect(spotify.search).not.toHaveBeenCalled();
    expect(youtube.search).toHaveBeenCalledTimes(1);
  });

  it("tries only five ranked candidates and preserves the ordered causes", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    spotify.preparePlayback.mockResolvedValue({ kind: "search", query: "query" });
    youtube.search.mockRejectedValue(new Error("youtube search"));
    const candidates = Array.from({ length: 7 }, (_, index) => media("soundcloud", `candidate-${index}`));
    soundcloud.search.mockResolvedValue(candidates);
    soundcloud.preparePlayback.mockImplementation(async song => {
      throw new Error(`prepare ${song.id}`);
    });
    const harness = setup([spotify, youtube, soundcloud]);
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", failed);

    await harness.distube.play(TARGET, media("spotify", "original"));
    await settle();

    expect(soundcloud.preparePlayback).toHaveBeenCalledTimes(5);
    const error = failed.mock.calls[0]?.[0].error;
    expect(error).toMatchObject({ code: "SOURCE_FAILED", cause: expect.any(AggregateError) });
    expect((error.cause as AggregateError).errors.map((cause: Error) => cause.message)).toEqual([
      "youtube search",
      ...candidates.slice(0, 5).map(song => `prepare ${song.id}`),
    ]);
  });

  it("deduplicates repeated Error instances in fallback exhaustion", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    const soundcloud = new FakeSource("soundcloud");
    const repeated = new Error("shared provider failure");
    spotify.preparePlayback.mockResolvedValue({ kind: "search", query: "query" });
    youtube.search.mockRejectedValue(repeated);
    soundcloud.search.mockResolvedValue([media("soundcloud", "candidate")]);
    soundcloud.preparePlayback.mockRejectedValue(repeated);
    const harness = setup([spotify, youtube, soundcloud]);
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", failed);

    await harness.distube.play(TARGET, media("spotify", "original"));
    await settle();

    const error = failed.mock.calls[0]?.[0].error;
    expect(error).toMatchObject({ code: "SOURCE_FAILED", cause: expect.any(AggregateError) });
    expect((error.cause as AggregateError).errors).toEqual([repeated]);
  });

  it("asks for five candidates where query resolution asks for one", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    spotify.preparePlayback.mockResolvedValueOnce({ kind: "search", query: "fallback query" });
    spotify.search.mockResolvedValue([media("spotify", "queried")]);
    youtube.search.mockResolvedValue([media("youtube", "candidate")]);
    const harness = setup([spotify, youtube]);

    await harness.distube.play(TARGET, media("spotify", "original"));
    await settle();
    await harness.distube.getQueue(GUILD)?.enqueue("a query");

    // One shared rule, two callers: the only thing that differs is how many candidates each consumes.
    expect(youtube.search).toHaveBeenCalledWith("fallback query", expect.objectContaining({ limit: 5 }));
    expect(spotify.search).toHaveBeenCalledWith("a query", expect.objectContaining({ limit: 1 }));
  });

  it("rejects a candidate whose owner is not the searching source", async () => {
    const spotify = new FakeSource("spotify");
    const youtube = new FakeSource("youtube");
    spotify.preparePlayback.mockResolvedValue({ kind: "search", query: "query" });
    youtube.search.mockResolvedValue([media("spotify", "wrong-owner")]);
    const harness = setup([spotify, youtube]);
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", failed);

    await harness.distube.play(TARGET, media("spotify", "original"));
    await settle();

    expect(youtube.preparePlayback).not.toHaveBeenCalled();
    expect(failed.mock.calls[0]?.[0].error.code).toBe("SOURCE_FAILED");
  });

  it("never falls back when the owning source itself fails to prepare", async () => {
    const original = new FakeSource("original");
    const other = new FakeSource("other");
    original.preparePlayback.mockRejectedValueOnce(new Error("provider failed"));
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
    original.preparePlayback.mockResolvedValueOnce(preparation);
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

describe("terminal authority", () => {
  it("clears logical state at once and hands the guild to a fresh queue", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const teardown = deferred<void>();
    (harness.engine.players[0] as FakePlayer).stopTrack.mockReturnValueOnce(teardown.promise);

    const stopping = queue.stop();
    expect(queue.state.upcoming).toEqual([]);
    expect(queue.state.current).toBeUndefined();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    teardown.resolve();
    await stopping;

    const second = await harness.distube.play(TARGET, "b");
    // Queues have no public ID; a fresh queue is a different facade object.
    expect(second.queue).not.toBe(queue);
  });

  it("unregisters the guild even when terminal cleanup rejects", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    (harness.engine.players[0] as FakePlayer).stopTrack.mockRejectedValue(new Error("cleanup failed"));

    await expect(queue.stop()).rejects.toMatchObject({ code: "VOICE_FAILED" });
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("waits for a Player activation accepted before deletion, then disposes it exactly once", async () => {
    const harness = playableSetup();
    const { preparation, dispose } = prepared("https://stream.example/late-player");
    harness.source.preparePlayback.mockResolvedValue(preparation);
    const activation = deferred<void>();
    armPlayer(harness.engine, player => player.play.mockReturnValueOnce(activation.promise));
    const started = vi.fn();
    harness.distube.on("queue.item.started", started);
    const call = harness.distube.play(TARGET, "a");
    const { queue } = await call;
    await settle();

    let settled = false;
    const stopping = queue.stop().finally(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);
    activation.resolve();
    await stopping;

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(started).not.toHaveBeenCalled();
    expect(queue.state.current).toBeUndefined();
  });

  it("waits for a Player created before deletion and keeps it free of queue effects", async () => {
    const harness = playableSetup();
    const creation = deferred<Player>();
    const late = new FakePlayer();
    harness.engine.createPlayer.mockReturnValueOnce(creation.promise);
    const call = harness.distube.play(TARGET, "a");
    const { queue } = await call;
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
    expect(late.requests).toHaveLength(0);
    expect(late.stopTrack).not.toHaveBeenCalled();
    expect(late.listeners.size).toBe(1);
    expect(queue.state.current).toBeUndefined();
  });

  it("aborts preparation for a removed item and disposes its late resource once", async () => {
    const harness = playableSetup();
    const preparation = deferred<PlaybackPreparation>();
    let signal: AbortSignal | undefined;
    harness.source.preparePlayback.mockImplementation(async (_song, context) => {
      signal = context.signal;
      return preparation.promise;
    });
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", failed);
    const { queue, items } = await harness.distube.play(TARGET, "selected");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;

    await queue.remove(items[0]?.id as string);
    expect(queue.state.upcoming.some(item => item.id === items[0]?.id)).toBe(false);
    expect(signal?.aborted).toBe(true);
    const { preparation: late, dispose } = prepared("https://stream.example/late");
    preparation.resolve(late);
    await settle();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(player.requests).toHaveLength(0);
    expect(failed).not.toHaveBeenCalled();
  });

  it("settles only once the active resource has finished disposing", async () => {
    const harness = playableSetup();
    const disposal = deferred<void>();
    const dispose = vi.fn(() => disposal.promise);
    harness.source.preparePlayback.mockResolvedValue({
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/slow", dispose },
    });
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
