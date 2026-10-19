import { describe, expect, it, vi } from "vitest";
import { DisTubeError, type Song } from "../src";
import type { PlaybackPreparation, SourcePlugin } from "../src/integrations";
import { preparePlaybackResource } from "../src/playback/prepare";
import { createSourceCatalog } from "../src/playback/sources";
import { capture, deferred, FakeSource, GUILD, media, mediaUrl, settle, setup, VOICE_CHANNEL } from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

function prepare(owner: FakeSource, others: readonly SourcePlugin[], signal = new AbortController().signal) {
  return preparePlaybackResource(
    media(owner.name),
    createSourceCatalog([owner, ...others]),
    signal,
    vi.fn(),
    resource => resource.dispose(),
    resource => {
      if (resource.kind !== "url") throw new DisTubeError("UNSUPPORTED", "Only URLs supported");
    },
  );
}

/** Three configured sources in constructor order, none of which answers anything until a test says so. */
function sources(): readonly [FakeSource, FakeSource, FakeSource] {
  return [new FakeSource("first"), new FakeSource("second"), new FakeSource("third")];
}

describe("string classification", () => {
  it("routes an absolute http or https URL to resolve and never to search", async () => {
    const [source] = sources();
    source.resolve.mockResolvedValue(media("first", "resolved"));
    const harness = setup([source]);

    const queue = await harness.distube.play(TARGET, mediaUrl("resolved", "first"));

    await settle();
    expect(queue.current?.song.id).toBe("resolved");
    expect(source.resolve).toHaveBeenCalledTimes(1);
    expect(source.search).not.toHaveBeenCalled();
  });

  it.each(["a song title", "artist: song title", "c418:sweden", "spotify:track:abcdef", "10:30 remix"])(
    "treats %j as a query rather than a URL",
    async query => {
      const [source] = sources();
      source.search.mockResolvedValue([media("first", "candidate")]);
      const harness = setup([source]);

      const queue = await harness.distube.play(TARGET, query);

      expect(source.search).toHaveBeenCalledWith(query, expect.objectContaining({ limit: 1 }));
      expect(source.resolve).not.toHaveBeenCalled();
      await settle();
      expect(queue.current?.song.id).toBe("candidate");
    },
  );

  it("rejects an empty or whitespace-only string before touching any source", async () => {
    const [source] = sources();
    const harness = setup([source]);

    await expect(harness.distube.play(TARGET, "   ")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(source.resolve).not.toHaveBeenCalled();
    expect(source.search).not.toHaveBeenCalled();
  });

  it("fails a URL every source declined instead of retrying it as a query", async () => {
    const [first, second] = sources();
    const harness = setup([first, second]);

    await expect(harness.distube.play(TARGET, "https://provider.example/unknown")).rejects.toMatchObject({
      code: "NO_RESULT",
      message: "No SourcePlugin resolved the source",
    });
    expect(first.resolve).toHaveBeenCalledTimes(1);
    expect(second.resolve).toHaveBeenCalledTimes(1);
    expect(first.search).not.toHaveBeenCalled();
    expect(second.search).not.toHaveBeenCalled();
  });
});

describe("query search chain", () => {
  it("stops at the first source with a candidate and leaves later sources unconsulted", async () => {
    const [first, second, third] = sources();
    first.search.mockResolvedValue([media("first", "wanted"), media("first", "ignored")]);
    second.search.mockResolvedValue([media("second", "later")]);
    const harness = setup([first, second, third]);

    const queue = await harness.distube.play(TARGET, "a query");

    await settle();
    expect(queue.upcoming).toHaveLength(0);
    await settle();
    expect(queue.current?.song.id).toBe("wanted");
    expect(second.search).not.toHaveBeenCalled();
    expect(third.search).not.toHaveBeenCalled();
  });

  it("does not search another source when the selected query Song cannot prepare", async () => {
    const [first, second] = sources();
    first.search.mockResolvedValue([media(first.name, "selected")]);
    first.stream.mockRejectedValue(new Error("stream unavailable"));
    const harness = setup([first, second]);

    await harness.distube.play(TARGET, "a query");
    await settle();

    expect(first.stream).toHaveBeenCalledTimes(1);
    expect(second.search).not.toHaveBeenCalled();
  });

  it("walks past sources that miss and consumes the first ranked candidate of the one that answers", async () => {
    const [first, second, third] = sources();
    third.search.mockResolvedValue([media("third", "wanted"), media("third", "ignored")]);
    const harness = setup([first, second, third]);

    const queue = await harness.distube.play(TARGET, "a query");

    expect([first.search, second.search, third.search].map(spy => spy.mock.calls.length)).toEqual([1, 1, 1]);
    await settle();
    expect(queue.current?.song.id).toBe("wanted");
    expect(queue.upcoming).toHaveLength(0);
  });

  it("records a mid-chain throw, continues, and keeps the failure out of the successful result", async () => {
    const [first, second, third] = sources();
    first.search.mockRejectedValue(new Error("provider down"));
    third.search.mockResolvedValue([media("third", "recovered")]);
    const harness = setup([first, second, third]);

    const queue = await harness.distube.play(TARGET, "a query");

    await settle();
    expect(queue.current?.song.id).toBe("recovered");
    expect(harness.diagnostics).not.toHaveBeenCalled();
  });

  it("aggregates every recorded cause when the whole chain is exhausted", async () => {
    const [first, second, third] = sources();
    const down = new Error("provider down");
    const refused = new Error("provider refused");
    first.search.mockRejectedValue(down);
    third.search.mockRejectedValue(refused);
    const harness = setup([first, second, third]);

    const failure = (await capture(harness.distube.play(TARGET, "a query"))) as { cause: AggregateError };

    expect(failure).toMatchObject({
      code: "SOURCE_FAILED",
      message: "No SourcePlugin found a result for the query",
    });
    // Only the sources that threw contribute a cause; the one that simply missed is not a failure.
    expect(failure.cause.errors).toMatchObject([{ message: down.message }, { message: refused.message }]);
  });

  it("aborts the signal handed to a searching source when the caller aborts, and stops the chain", async () => {
    const [first, second] = sources();
    const reached = deferred<void>();
    const held = deferred<never>();
    first.search.mockImplementation(async () => {
      reached.resolve();
      return held.promise;
    });
    const harness = setup([first, second]);
    const controller = new AbortController();

    const play = capture(harness.distube.play(TARGET, "a query", { signal: controller.signal }));
    await reached.promise;
    const signal = first.search.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    controller.abort();
    expect(signal?.aborted).toBe(true);
    held.reject(new Error("cancelled by provider"));

    expect(await play).toMatchObject({ code: "ABORTED" });
    expect(second.search).not.toHaveBeenCalled();
    expect(harness.distube.queues.size).toBe(0);
  });
});

describe("query entry points", () => {
  it("resolves a query through enqueue on a live queue", async () => {
    const [source] = sources();
    source.search.mockImplementation(async query => [media("first", query)]);
    const harness = setup([source]);
    const queue = await harness.distube.play(TARGET, "seed");
    await settle();

    const [item] = await queue.add("follow up");

    expect(item?.song.id).toBe("follow up");
    expect(queue.upcoming.map(queued => queued.song.id)).toEqual(["follow up"]);
  });

  it("fences resolve() once shutdown has started", async () => {
    const [source] = sources();
    source.search.mockResolvedValue([media("first", "standalone")]);
    const harness = setup([source]);

    await harness.distube.dispose();

    await expect(harness.distube.resolve("a query")).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "DisTube is disposed",
    });
    expect(source.search).not.toHaveBeenCalled();
  });
});

describe("operation-specific discovery", () => {
  it.each([undefined, null, {}, media("first"), [media("foreign")], [undefined]])(
    "fails public search on malformed output %j while query resolution continues",
    async malformed => {
      const [first, second] = sources();
      first.search.mockResolvedValue(malformed as unknown as readonly Song[]);
      const winner = media("second");
      second.search.mockResolvedValue([winner]);
      const { distube } = setup([first, second]);
      await expect(distube.search("query")).rejects.toMatchObject({ code: "SOURCE_FAILED" });
      expect(second.search).not.toHaveBeenCalled();
      await expect(distube.resolve("query")).resolves.toBe(winner);
    },
  );

  it("skips absent discovery methods and rejects explicitly selected unsupported search", async () => {
    const resolveOnly: SourcePlugin = {
      name: "resolve-only",
      resolve: vi.fn(async () => media("resolve-only")),
      stream: vi.fn(async () => ({ kind: "search" as const, query: "query" })),
    };
    const searchOnly: SourcePlugin = {
      name: "search-only",
      search: vi.fn(async () => [media("search-only")]),
      stream: vi.fn(async () => ({ kind: "search" as const, query: "query" })),
    };
    const { distube } = setup([searchOnly, resolveOnly]);
    await expect(distube.resolve("https://provider.example/song")).resolves.toMatchObject({ source: "resolve-only" });
    await expect(distube.search("query", { source: resolveOnly })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(distube.search("query")).resolves.toEqual([media("search-only")]);
    await expect(distube.resolve("query")).resolves.toMatchObject({ source: "search-only" });
  });

  it("fails public search immediately on a provider exception", async () => {
    const [first, second] = sources();
    first.search.mockRejectedValue(new Error("provider unavailable"));
    const { distube } = setup([first, second]);
    await expect(distube.search("query")).rejects.toMatchObject({ code: "SOURCE_FAILED" });
    expect(second.search).not.toHaveBeenCalled();
  });
});

describe("bounded explicit playback fallback", () => {
  it("records a malformed fallback search and continues to a later source", async () => {
    const [owner, malformed, winner] = sources();
    owner.stream.mockResolvedValue({ kind: "search", query: "original query" });
    malformed.search.mockResolvedValue(undefined as unknown as readonly Song[]);
    winner.search.mockResolvedValue([media(winner.name, "playable")]);

    const resource = await prepare(owner, [malformed, winner]);

    expect(malformed.search).toHaveBeenCalledTimes(1);
    expect(winner.search).toHaveBeenCalledWith("original query", expect.objectContaining({ limit: 5 }));
    expect(winner.stream).toHaveBeenCalledTimes(1);
    await resource.dispose();
  });

  it("continues to later sources after five failures without changing occurrence identity", async () => {
    const [owner, first, second] = sources();
    const original = media(owner.name);
    const metadata = { requestedBy: "caller" };
    owner.stream.mockResolvedValue({ kind: "search", query: "original query" });
    first.search.mockResolvedValue(Array.from({ length: 8 }, (_, index) => media(first.name, String(index))));
    first.stream.mockRejectedValue(new Error("cannot prepare"));
    second.search.mockResolvedValue([media(second.name, "winner")]);
    const harness = setup([owner, first, second]);
    const queue = await harness.distube.play(TARGET, original, { metadata });
    await settle();
    expect(first.stream.mock.calls.map(([song]) => song.id)).toEqual(["0", "1", "2", "3", "4"]);
    expect(second.stream).toHaveBeenCalledTimes(1);
    expect(queue.current?.song).toBe(original);
    expect(queue.current?.metadata).toBe(metadata);
    const occurrence = queue.current;
    await settle();
    expect(queue.current).toBe(occurrence);
    expect(owner.search).not.toHaveBeenCalled();
  });

  it("prepares a repeated candidate ID once per source", async () => {
    const [owner, first, second] = sources();
    owner.stream.mockResolvedValue({ kind: "search", query: "original query" });
    first.search.mockResolvedValue([media(first.name, "same"), media(first.name, "same")]);
    first.stream.mockRejectedValue(new Error("cannot prepare"));
    second.search.mockResolvedValue([media(second.name, "same")]);
    const resource = await prepare(owner, [first, second]);
    expect(first.stream).toHaveBeenCalledTimes(1);
    expect(second.stream).toHaveBeenCalledTimes(1);
    await resource.dispose();
  });

  it("disposes incompatible and malformed candidates before preparing a usable one", async () => {
    const [owner, first] = sources();
    owner.stream.mockResolvedValue({ kind: "search", query: "query" });
    first.search.mockResolvedValue([
      media(first.name, "encoded"),
      media(first.name, "malformed"),
      media(first.name, "ok"),
    ]);
    const log: string[] = [];
    first.stream.mockImplementation(async song => {
      log.push(`prepare ${song.id}`);
      if (song.id === "encoded") {
        return {
          kind: "resource",
          resource: {
            kind: "encoded",
            encoded: "opaque",
            format: "foreign",
            dispose: () => {
              log.push("dispose encoded");
            },
          },
        };
      }
      if (song.id === "malformed") {
        return {
          kind: "resource",
          resource: {
            kind: "url",
            url: "invalid",
            dispose: () => {
              log.push("dispose malformed");
            },
          },
        };
      }
      return first.resourceFor(song);
    });
    const resource = await prepare(owner, [first]);
    expect(log).toEqual(["prepare encoded", "dispose encoded", "prepare malformed", "dispose malformed", "prepare ok"]);
    await resource.dispose();
  });

  it("enforces 25 preparations even when deduplication leaves a partial final batch", async () => {
    const owner = new FakeSource("owner");
    owner.stream.mockResolvedValue({ kind: "search", query: "query" });
    const candidates = Array.from({ length: 7 }, (_, index) => new FakeSource(`source-${index}`));
    for (const [index, source] of candidates.entries()) {
      source.search.mockResolvedValue(
        Array.from({ length: 5 }, (_, rank) => media(source.name, String(index === 0 ? 0 : rank))),
      );
      source.stream.mockResolvedValue({ kind: "search", query: "no recursion" });
    }
    await expect(prepare(owner, candidates)).rejects.toMatchObject({ code: "NO_RESULT" });
    expect(candidates.map(source => source.stream.mock.calls.length)).toEqual([1, 5, 5, 5, 5, 4, 0]);
    expect(candidates[6]?.search).not.toHaveBeenCalled();
  });

  it("records incompatible resource failures on exhaustion", async () => {
    const [owner, first] = sources();
    owner.stream.mockResolvedValue({ kind: "search", query: "query" });
    first.search.mockResolvedValue([media(first.name)]);
    const dispose = vi.fn();
    first.stream.mockResolvedValue({
      kind: "resource",
      resource: { kind: "encoded", encoded: "opaque", format: "foreign", dispose },
    });
    const failure = await capture(prepare(owner, [first]));
    expect(failure).toMatchObject({
      code: "SOURCE_FAILED",
      cause: { errors: [expect.objectContaining({ code: "UNSUPPORTED" })] },
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps incompatible fallback and cleanup causes on exhaustion", async () => {
    const [owner, first] = sources();
    owner.stream.mockResolvedValue({ kind: "search", query: "query" });
    first.search.mockResolvedValue([media(first.name)]);
    const dispose = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    first.stream.mockResolvedValue({
      kind: "resource",
      resource: { kind: "encoded", encoded: "opaque", format: "foreign", dispose },
    });

    const failure = await capture(prepare(owner, [first]));
    expect(failure).toMatchObject({ code: "SOURCE_FAILED", cause: expect.any(AggregateError) });
    const candidate = ((failure as DisTubeError).cause as AggregateError).errors[0] as DisTubeError;
    expect(candidate).toMatchObject({ code: "UNSUPPORTED", cause: expect.any(AggregateError) });
    expect(((candidate.cause as AggregateError).errors as Error[]).map(error => error.message)).toEqual([
      "Only URLs supported",
      "Playback resource cleanup failed",
    ]);
    const cleanup = (candidate.cause as AggregateError).errors[1] as AggregateError;
    expect((cleanup.errors[0] as Error).message).toBe("cleanup failed");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("cleans a late resource once on cancellation and stops further candidates", async () => {
    const [owner, first, second] = sources();
    owner.stream.mockResolvedValue({ kind: "search", query: "query" });
    first.search.mockResolvedValue([media(first.name, "late"), media(first.name, "later")]);
    const held = deferred<PlaybackPreparation>();
    const reached = deferred<void>();
    first.stream.mockImplementation(() => {
      reached.resolve();
      return held.promise;
    });
    const controller = new AbortController();
    const result = capture(prepare(owner, [first, second], controller.signal));
    await reached.promise;
    controller.abort();
    held.resolve(first.resourceFor(media(first.name, "late")));
    expect(await result).toMatchObject({ code: "ABORTED" });
    expect(first.disposed).toEqual(["late"]);
    expect(first.stream).toHaveBeenCalledTimes(1);
    expect(second.search).not.toHaveBeenCalled();
  });
});
