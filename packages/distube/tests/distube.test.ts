import { describe, expect, it, vi } from "vitest";
import { DisTube, DisTubeError, ErrorCode, Playlist, Song } from "../src";
import type { Plugin } from "../src/integrations";
import {
  capture,
  deferred,
  FakeAdapter,
  FakeSource,
  GUILD,
  media,
  mediaUrl,
  playableSetup,
  PreparingEngine,
  record,
  settle,
  setup,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

function sources(): readonly [FakeSource, FakeSource, FakeSource] {
  return [new FakeSource("first"), new FakeSource("second"), new FakeSource("third")];
}

function construct(plugins: readonly Plugin[], options: object = {}): () => DisTube {
  return () => new DisTube({ adapter: new FakeAdapter(), plugins, ...options });
}

const invalidArgument = expect.objectContaining({ code: "INVALID_ARGUMENT" });

/** What another installed copy of the package throws: same name and code, different class. */
class SecondCopyError extends Error {
  readonly code = "NOT_FOUND";

  constructor(message: string) {
    super(message);
    this.name = "DisTubeError";
  }
}

describe("client construction", () => {
  it.each([
    { historySize: -1 },
    { historySize: 2.5 },
    { maxPlaylistSongs: 0 },
    { maxPlaylistSongs: 1.5 },
    { connectionTimeoutMs: 0 },
    { connectionTimeoutMs: 2 ** 31 },
    { idleTimeoutMs: -1 },
    { idleTimeoutMs: 1.5 },
    { idleTimeoutMs: Number.NaN },
    { idleTimeoutMs: 2 ** 31 },
    { engine: { opusComplexity: 11 } },
    { engine: { bufferMs: 30 } },
    { engine: { bufferMs: 0 } },
  ])("rejects the numeric option %j with INVALID_ARGUMENT", options => {
    expect(construct([new FakeSource("source")], options)).toThrowError(invalidArgument);
  });

  it.each(["connectionTimeoutMs", "idleTimeoutMs"])("accepts %s at the timer ceiling 2147483647", option => {
    expect(construct([new FakeSource("source")], { [option]: 2 ** 31 - 1 })).not.toThrow();
  });

  it.each(["", " padded", "padded ", 42])("rejects the plugin name %j with INVALID_ARGUMENT", name => {
    expect(construct([new FakeSource(name as string)])).toThrowError(invalidArgument);
  });

  it("rejects duplicate plugin names and a plugin with no operation", () => {
    expect(construct([new FakeSource("same"), new FakeSource("same")])).toThrowError(invalidArgument);
    expect(construct([{ name: "empty", dispose: () => undefined }])).toThrowError(invalidArgument);
  });

  it("accepts a plugin that has only stream", () => {
    expect(construct([{ name: "clips", stream: async () => ({ kind: "file", path: "/clips/a.ogg" }) }])).not.toThrow();
  });

  it("accepts a plugin without stream only beside an engine plugin or another plugin with search and stream", () => {
    const spotify: Plugin = { name: "spotify", resolve: async () => undefined, search: async () => [] };
    const streamOnly: Plugin = { name: "clips", stream: async () => ({ kind: "file", path: "/clips/a.ogg" }) };
    const searchOnly: Plugin = { name: "index", search: async () => [] };
    expect(construct([spotify])).toThrowError(invalidArgument);
    expect(construct([spotify, streamOnly, searchOnly])).toThrowError(invalidArgument);
    expect(construct([spotify, new FakeSource("youtube")])).not.toThrow();
    expect(construct([spotify, { name: "remote", engine: new PreparingEngine() }])).not.toThrow();
  });

  it("rejects a second engine plugin", () => {
    const remote = { name: "remote", engine: new PreparingEngine() };
    const other = { name: "other", engine: new PreparingEngine() };
    expect(construct([remote, other])).toThrowError(invalidArgument);
  });

  it("asks the adapter for its built-in engine with the configured settings and contacts nothing", () => {
    const adapter = new FakeAdapter();
    const filters = { bright: { render: () => "treble=g=5" } };
    const source = new FakeSource("source");
    const distube = new DisTube({ adapter, plugins: [source], filters, engine: { opusComplexity: 5, bufferMs: 200 } });
    expect(distube.queues.size).toBe(0);
    expect(adapter.createEngine).toHaveBeenCalledWith({ filters, opusComplexity: 5, bufferMs: 200 });
    expect(adapter.createVoiceSession).not.toHaveBeenCalled();
    expect(source.search).not.toHaveBeenCalled();
  });

  it("plays through an engine plugin and never creates the built-in engine", async () => {
    const adapter = new FakeAdapter();
    const engine = new PreparingEngine();
    const source = new FakeSource("source");
    source.search.mockImplementation(async query => [media("source", query)]);
    const distube = new DisTube({
      adapter,
      plugins: [source, { name: "remote", engine }],
      filters: { ignored: { render: () => "ignored" } },
    });
    await distube.play(TARGET, "a");
    await settle();
    expect(adapter.createEngine).not.toHaveBeenCalled();
    expect(engine.prepare).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), expect.anything());
    expect(engine.player.played).toHaveLength(1);
    await distube.dispose();
  });

  it("keeps the plugin list it was constructed with", async () => {
    const [first, late] = sources();
    const plugins = [first];
    const distube = new DisTube({ adapter: new FakeAdapter(), plugins });
    plugins.push(late);
    await expect(distube.play(TARGET, "declined")).rejects.toMatchObject({ code: "NO_RESULT" });
    expect(late.search).not.toHaveBeenCalled();
    await distube.dispose();
    expect(late.dispose).not.toHaveBeenCalled();
  });
});

describe("string routing", () => {
  it("routes an absolute http or https URL to resolve and never to search", async () => {
    const [source] = sources();
    source.resolve.mockResolvedValue(media("first", "resolved"));
    const harness = setup([source]);
    await expect(harness.distube.resolve(mediaUrl("resolved", "first"))).resolves.toMatchObject({ id: "resolved" });
    expect(source.search).not.toHaveBeenCalled();
  });

  it.each(["a song title", "artist: song title", "spotify:track:abcdef", "/music/song.mp3", "10:30 remix"])(
    "searches %j as a query",
    async query => {
      const [source] = sources();
      source.search.mockResolvedValue([media("first", "candidate")]);
      const harness = setup([source]);
      await expect(harness.distube.resolve(query)).resolves.toMatchObject({ id: "candidate" });
      expect(source.search).toHaveBeenCalledWith(query, expect.objectContaining({ limit: 1, offset: 0 }));
      expect(source.resolve).not.toHaveBeenCalled();
    },
  );

  it("rejects a whitespace-only string before any plugin or queue", async () => {
    const [source] = sources();
    const harness = setup([source]);
    await expect(harness.distube.play(TARGET, "   ")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(harness.distube.queues.size).toBe(0);
    expect(source.resolve).not.toHaveBeenCalled();
    expect(source.search).not.toHaveBeenCalled();
  });

  it("asks the next plugin after a decline and fails NO_RESULT without searching the URL", async () => {
    const [first, second, third] = sources();
    second.resolve.mockImplementation(async () => media("second", "item"));
    const harness = setup([first, second, third]);
    await expect(harness.distube.resolve("https://provider.example/item")).resolves.toMatchObject({
      source: "second",
    });
    expect(third.resolve).not.toHaveBeenCalled();

    second.resolve.mockResolvedValue(undefined);
    await expect(harness.distube.resolve("https://provider.example/other")).rejects.toMatchObject({
      code: "NO_RESULT",
      query: "https://provider.example/other",
    });
    expect([first.search, second.search, third.search].every(search => search.mock.calls.length === 0)).toBe(true);
  });

  it("stops URL resolution at a throwing plugin, wrapping a plain error once with its source", async () => {
    const [first, second] = sources();
    const failure = new TypeError("provider broke");
    first.resolve.mockRejectedValue(failure);
    const harness = setup([first, second]);
    await expect(harness.distube.resolve("https://provider.example/item")).rejects.toMatchObject({
      code: "SOURCE_FAILED",
      source: "first",
      cause: failure,
    });
    expect(second.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ["this copy", new DisTubeError("NOT_FOUND", "provider says no")],
    ["a second copy", new SecondCopyError("provider says no")],
    ["a rate limit", new DisTubeError("RATE_LIMITED", "slow down")],
  ])("passes a plugin-owned DisTubeError from %s through unchanged", async (_copy, failure) => {
    const harness = playableSetup();
    harness.source.resolve.mockRejectedValueOnce(failure);
    await expect(harness.distube.play(TARGET, "https://provider.example/item")).rejects.toBe(failure);
  });

  it("wraps a plugin's own INVALID_ARGUMENT, INVALID_STATE or ABORTED as SOURCE_FAILED with the source and the original as cause", async () => {
    const harness = playableSetup("acme");
    harness.source.resolve.mockImplementationOnce(
      async () => new Song({ id: "a", name: "", url: "u", source: "acme" }),
    );
    const failure = (await capture(harness.distube.play(TARGET, mediaUrl("a", "acme")))) as DisTubeError;
    expect(failure).toMatchObject({ code: "SOURCE_FAILED", source: "acme" });
    expect(failure.cause).toMatchObject({ code: "INVALID_ARGUMENT" });
    for (const code of ["INVALID_STATE", "ABORTED"] as const) {
      const rejected = new DisTubeError(code, "provider says so");
      harness.source.resolve.mockRejectedValueOnce(rejected);
      const rewrapped = (await capture(harness.distube.resolve(mediaUrl("b", "acme")))) as DisTubeError;
      expect(rewrapped).toMatchObject({ code: "SOURCE_FAILED", source: "acme", cause: rejected });
    }
  });

  it("narrows by name and a known code, so a second copy's error matches and a plain Error with the code does not", () => {
    const foreign = new SecondCopyError("gone");
    expect(DisTubeError.is(foreign, ErrorCode.NOT_FOUND)).toBe(true);
    expect(DisTubeError.is(foreign)).toBe(true);
    expect(DisTubeError.is(foreign, ErrorCode.ABORTED)).toBe(false);
    expect(DisTubeError.is(Object.assign(new Error("gone"), { code: "NOT_FOUND" }), ErrorCode.NOT_FOUND)).toBe(false);
    expect(DisTubeError.is(Object.assign(new Error("gone"), { name: "DisTubeError", code: "YOUTUBE_GONE" }))).toBe(
      false,
    );
  });

  it("takes the first candidate of the first answering plugin, walking past misses and throws", async () => {
    const [first, second, third] = sources();
    first.search.mockRejectedValue(new Error("provider down"));
    second.search.mockResolvedValue([media("second", "wanted"), media("second", "ignored")]);
    const harness = setup([first, second, third]);
    await expect(harness.distube.resolve("a query")).resolves.toMatchObject({ id: "wanted" });
    expect(third.search).not.toHaveBeenCalled();
    expect(harness.diagnostics).not.toHaveBeenCalled();
  });

  it("fails an exhausted query NO_RESULT, or SOURCE_FAILED with every recorded failure", async () => {
    const [first, second, third] = sources();
    const harness = setup([first, second, third]);
    const empty = (await capture(harness.distube.resolve("zzzz"))) as DisTubeError;
    expect([empty.code, empty.query, empty.source]).toEqual(["NO_RESULT", "zzzz", undefined]);

    const down = new Error("provider down");
    const refused = new Error("provider refused");
    first.search.mockRejectedValue(down);
    third.search.mockRejectedValue(refused);
    const failure = (await capture(harness.distube.resolve("a query"))) as DisTubeError;
    expect([failure.code, failure.query]).toEqual(["SOURCE_FAILED", "a query"]);
    expect((failure.cause as AggregateError).errors).toMatchObject([{ cause: down }, { cause: refused }]);
  });

  it("rejects media a plugin returns for another source", async () => {
    const harness = playableSetup();
    harness.source.resolve.mockResolvedValueOnce(media("spotify", "foreign"));
    const added = vi.fn();
    harness.distube.on("queue.item.added", added);
    await expect(harness.distube.play(TARGET, mediaUrl("foreign"))).rejects.toMatchObject({ code: "SOURCE_FAILED" });
    await settle();
    expect(added).not.toHaveBeenCalled();
  });

  it("passes caller media through and rejects media naming no configured plugin", async () => {
    const harness = playableSetup();
    const song = media("source", "a");
    await expect(harness.distube.resolve(song)).resolves.toBe(song);
    await expect(harness.distube.play(TARGET, media("elsewhere"))).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(harness.distube.queues.size).toBe(0);
    await expect(harness.distube.resolve(media("elsewhere"))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const queue = await harness.distube.play(TARGET, song);
    await expect(queue.add(media("elsewhere"))).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(queue.upcoming).toEqual([]);
    expect(harness.source.resolve).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a Playlist mixing an owned and an unowned Song",
      new Playlist({
        id: "mixed",
        name: "Mixed",
        url: "https://source.example/list/mixed",
        source: "source",
        songs: [media("source", "a"), media("elsewhere", "b")],
      }),
    ],
    ["an object that is not media", { source: "source", id: "a" }],
  ])("rejects %s INVALID_ARGUMENT before creating a queue", async (_name, input) => {
    const harness = playableSetup();
    const events = record(harness.distube, ["queue.created"]);
    await expect(harness.distube.play(TARGET, input as Song)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.resolve(input as Song)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(events).toEqual([]);
    expect(harness.distube.queues.size).toBe(0);
  });
});

describe("public search", () => {
  it("returns the first non-empty list with default window limit 10 and offset 0", async () => {
    const [first, second] = sources();
    second.search.mockResolvedValue([media("second", "a"), media("second", "b")]);
    const harness = setup([first, second]);
    const songs = await harness.distube.search("lofi");
    expect(songs.map(song => song.id)).toEqual(["a", "b"]);
    expect(first.search).toHaveBeenCalledWith("lofi", expect.objectContaining({ limit: 10, offset: 0 }));
  });

  it("fails fast on a provider failure and never tries later plugins", async () => {
    const [first, second] = sources();
    first.search.mockRejectedValue(new Error("provider unavailable"));
    second.search.mockResolvedValue([media("second")]);
    const harness = setup([first, second]);
    await expect(harness.distube.search("query")).rejects.toMatchObject({ code: "SOURCE_FAILED", source: "first" });
    expect(second.search).not.toHaveBeenCalled();
  });

  it("validates source and window before calling any plugin", async () => {
    const [first] = sources();
    const resolveOnly: Plugin = {
      name: "resolve-only",
      resolve: async () => undefined,
      stream: async () => ({ kind: "file", path: "/q.ogg" }),
    };
    const harness = setup([first, resolveOnly]);
    await expect(harness.distube.search("q", { source: new FakeSource("foreign") })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(harness.distube.search("q", { source: resolveOnly })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(harness.distube.search("q", { limit: 0 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.search("q", { offset: -1 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(first.search).not.toHaveBeenCalled();
  });

  it("rejects a result list holding another source's Song", async () => {
    const [first] = sources();
    first.search.mockResolvedValue([media("first"), media("foreign")]);
    const harness = setup([first]);
    await expect(harness.distube.search("q", { source: first })).rejects.toMatchObject({ code: "SOURCE_FAILED" });
  });
});

function playlistOf(count: number): Playlist {
  return new Playlist({
    id: "list",
    name: "List",
    url: mediaUrl("list"),
    source: "source",
    songs: Array.from({ length: count }, (_, index) => media("source", `s${index}`)),
  });
}

const firstIds = (count: number): string[] => Array.from({ length: count }, (_, index) => `s${index}`);

describe("playlist cap", () => {
  it.each([
    [undefined, 700, 500],
    [3, 5, 3],
    [5000, 700, 700],
  ])(
    "with maxPlaylistSongs %s, passes the cap to resolve and keeps the first Songs of a %s-Song Playlist",
    async (maxPlaylistSongs, count, kept) => {
      const harness = playableSetup("source", maxPlaylistSongs === undefined ? {} : { maxPlaylistSongs });
      harness.source.resolve.mockImplementation(async () => playlistOf(count));
      const added: string[][] = [];
      harness.distube.on("queue.playlist.added", event => void added.push(event.items.map(item => item.song.id)));

      const resolved = await harness.distube.resolve(mediaUrl("list"));
      await harness.distube.play(TARGET, mediaUrl("list"));
      await settle();

      expect(harness.source.resolve).toHaveBeenCalledWith(
        mediaUrl("list"),
        expect.objectContaining({ maxPlaylistSongs: maxPlaylistSongs ?? 500 }),
      );
      expect((resolved as Playlist).songs.map(song => song.id)).toEqual(firstIds(kept));
      expect(added).toEqual([firstIds(kept)]);
    },
  );

  it("commits every Song of a Playlist passed in directly", async () => {
    const harness = playableSetup("source", { maxPlaylistSongs: 10 });
    const queue = await harness.distube.play(TARGET, playlistOf(20));
    expect([queue.current, ...queue.upcoming].filter(item => item !== undefined)).toHaveLength(20);
  });
});

describe("suggestions", () => {
  it("returns the first non-empty answer, skips plugins without suggest and propagates failures", async () => {
    const [first, second, third] = sources();
    const suggest = vi.fn(async (): Promise<readonly string[]> => ["lofi"]);
    const failing = vi.fn(async (): Promise<readonly string[]> => {
      throw new Error("suggest down");
    });
    const harness = setup([first, Object.assign(second, { suggest }), Object.assign(third, { suggest: failing })]);
    await expect(harness.distube.suggest("lo")).resolves.toEqual(["lofi"]);
    expect(failing).not.toHaveBeenCalled();

    suggest.mockResolvedValueOnce([]);
    await expect(harness.distube.suggest("lo")).rejects.toMatchObject({ code: "SOURCE_FAILED" });
    await expect(harness.distube.suggest("lo", { source: first })).resolves.toEqual([]);
  });
});

describe("cancellation", () => {
  it("rejects an already-aborted signal ABORTED before any plugin call or queue creation", async () => {
    const harness = playableSetup();
    const events = record(harness.distube, ["queue.created", "queue.deleted"]);
    const controller = new AbortController();
    controller.abort("just a string");
    const failure = (await capture(
      harness.distube.resolve(mediaUrl("a"), { signal: controller.signal }),
    )) as DisTubeError;
    expect(failure.code).toBe("ABORTED");
    expect(failure.cause).toBeUndefined();
    await expect(harness.distube.play(TARGET, "a", { signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
    });
    await settle();
    expect(events).toEqual([]);
    expect(harness.distube.queues.size).toBe(0);
    expect(harness.source.resolve).not.toHaveBeenCalled();
    expect(harness.source.search).not.toHaveBeenCalled();
  });

  it("keeps the caller's Error reason as the cause when the provider rejects after the abort", async () => {
    const harness = playableSetup();
    const reached = deferred<AbortSignal>();
    const held = deferred<never>();
    harness.source.resolve.mockImplementationOnce(async (_url, options) => {
      reached.resolve(options.signal);
      return held.promise;
    });
    const controller = new AbortController();
    const resolving = capture(harness.distube.resolve(mediaUrl("a"), { signal: controller.signal }));
    const signal = await reached.promise;
    const reason = new DisTubeError("INVALID_STATE", "caller cancelled");
    controller.abort(reason);
    expect(signal.aborted).toBe(true);
    held.reject(new Error("provider abort"));
    const failure = (await resolving) as DisTubeError;
    expect(failure.code).toBe("ABORTED");
    expect(failure).not.toBe(reason);
    expect(failure.cause).toBe(reason);
  });

  it("keeps ABORTED when a plugin throws a pass-through DisTubeError after the caller aborted", async () => {
    const harness = playableSetup();
    const reached = deferred<void>();
    const held = deferred<never>();
    harness.source.resolve.mockImplementationOnce(async () => {
      reached.resolve();
      return held.promise;
    });
    const controller = new AbortController();
    const resolving = capture(harness.distube.resolve(mediaUrl("a"), { signal: controller.signal }));
    await reached.promise;
    controller.abort();
    held.reject(new DisTubeError("NOT_FOUND", "provider closed"));
    expect(await resolving).toMatchObject({ code: "ABORTED" });
  });

  it("aborts a searching play, stops the chain and deletes the empty queue", async () => {
    const [first, second] = sources();
    const reached = deferred<void>();
    const held = deferred<never>();
    first.search.mockImplementation(async () => {
      reached.resolve();
      return held.promise;
    });
    const harness = setup([first, second]);
    const deleted = vi.fn();
    harness.distube.on("queue.deleted", event => deleted(event.reason));
    const controller = new AbortController();
    const playing = capture(harness.distube.play(TARGET, "a query", { signal: controller.signal }));
    await reached.promise;
    controller.abort();
    held.reject(new Error("cancelled by provider"));
    expect(await playing).toMatchObject({ code: "ABORTED" });
    await settle();
    expect(second.search).not.toHaveBeenCalled();
    expect(harness.distube.queues.size).toBe(0);
    expect(deleted).toHaveBeenCalledWith("failed");
  });
});

describe("events and diagnostics", () => {
  it("returns an idempotent unsubscribe for each registration", async () => {
    const harness = playableSetup();
    const listener = vi.fn();
    const unsubscribe = harness.distube.on("queue.item.added", listener);
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribe();
    await queue.add("b");
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    await harness.distube.dispose();
  });

  it("isolates a failing listener and reports it once without affecting playback", async () => {
    const harness = playableSetup();
    const later = vi.fn();
    harness.distube.on("queue.item.started", () => {
      throw new Error("listener failed");
    });
    harness.distube.on("queue.item.started", later);
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    expect(queue.current?.song.id).toBe("a");
    expect(later).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "error",
        stage: "event.listener",
        message: expect.stringContaining("started"),
      }),
    );
    await harness.distube.dispose();
  });

  it("observes a rejecting diagnostic consumer without calling it for its own failure", async () => {
    const onDiagnostic = vi.fn(() => Promise.reject(new Error("consumer down")));
    const harness = playableSetup("source", { onDiagnostic });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    harness.distube.on("queue.item.added", () => {
      throw new Error("listener failed");
    });
    await harness.distube.play(TARGET, "a");
    await settle();
    process.off("unhandledRejection", unhandled);
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
    await harness.distube.dispose();
  });
});

describe("disposal", () => {
  it("memoizes the shutdown, disposes plugins once in reverse order and fences later commands", async () => {
    const [first, second] = sources();
    const order: string[] = [];
    first.dispose.mockImplementation(() => void order.push("first"));
    second.dispose.mockImplementation(() => void order.push("second"));
    const harness = setup([first, second]);
    const shutdown = harness.distube.dispose();
    expect(harness.distube.dispose()).toBe(shutdown);
    await shutdown;
    expect(order).toEqual(["second", "first"]);
    await expect(harness.distube.play(TARGET, "a")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(harness.distube.resolve("a")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(first.search).not.toHaveBeenCalled();
  });

  it("rejects malformed arguments INVALID_ARGUMENT on a disposed client and a released voice", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    await harness.distube.dispose();
    await expect(voice.move({ guildId: "other", id: VOICE_CHANNEL })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(harness.distube.play(TARGET, "")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.voices.join(TARGET, { selfDeaf: "x" as never })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(voice.filters.set("")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(voice.filters.toggle("")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.resolve("")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.search("")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.suggest("")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
  });

  it("deletes every queue then leaves every voice with reason shutdown", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    await settle();
    const reasons: string[] = [];
    harness.distube.on("queue.deleted", event => void reasons.push(`queue:${event.reason}`));
    harness.distube.on("voice.disconnected", event => void reasons.push(`voice:${event.reason}`));
    await harness.distube.dispose();
    await settle();
    expect(reasons).toEqual(["queue:shutdown", "voice:shutdown"]);
    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
  });

  it("aborts an in-flight resolution so it never consults another plugin", async () => {
    const [first, second] = sources();
    const response = deferred<Song | undefined>();
    first.resolve.mockReturnValueOnce(response.promise);
    const harness = setup([first, second]);
    const resolving = capture(harness.distube.resolve(mediaUrl("race")));
    await settle();
    const shutdown = harness.distube.dispose();
    response.resolve(undefined);
    expect(await resolving).toMatchObject({ code: "INVALID_STATE" });
    expect(second.resolve).not.toHaveBeenCalled();
    await shutdown;
  });

  it("attempts every plugin cleanup and rejects SOURCE_FAILED with each failure", async () => {
    const [first, second] = sources();
    const raw = new Error("first dispose failed");
    first.dispose.mockImplementation(() => {
      throw raw;
    });
    second.dispose.mockImplementation(() => {
      throw "second dispose failed";
    });
    const harness = setup([first, second]);
    const failure = (await capture(harness.distube.dispose())) as DisTubeError;
    expect(failure.code).toBe("SOURCE_FAILED");
    expect((failure.cause as AggregateError).errors).toEqual(["second dispose failed", raw]);
  });

  it("classifies a voice cleanup failure as VOICE_FAILED", async () => {
    const harness = playableSetup();
    await harness.distube.voices.join(TARGET);
    harness.source.dispose.mockImplementation(() => {
      throw new Error("plugin failed too");
    });
    harness.adapter.session.release.mockRejectedValueOnce(new Error("session release failed"));
    const failure = (await capture(harness.distube.dispose())) as DisTubeError;
    expect(failure.code).toBe("VOICE_FAILED");
    expect((failure.cause as AggregateError).errors).toHaveLength(2);
  });
});

it("publishes queue.created then queue.deleted for a failed only play", async () => {
  const harness = playableSetup();
  harness.source.search.mockRejectedValueOnce(new DisTubeError("UNAVAILABLE", "region locked"));
  const events = record(harness.distube, ["queue.created", "queue.deleted"]);
  await expect(harness.distube.play(TARGET, "a")).rejects.toMatchObject({ code: "SOURCE_FAILED" });
  await settle();
  expect(events).toEqual(["queue.created", "queue.deleted"]);
  expect(harness.distube.getQueue(GUILD)).toBeUndefined();
});
