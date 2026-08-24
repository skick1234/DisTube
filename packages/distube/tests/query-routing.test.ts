import { describe, expect, it } from "vitest";
import { ErrorCode } from "../src";
import { capture, deferred, FakeSource, GUILD, media, mediaUrl, settle, setup, VOICE_CHANNEL } from "./support/harness";

const TARGET = { guildId: GUILD, voiceChannelId: VOICE_CHANNEL };

/** Three configured sources in constructor order, none of which answers anything until a test says so. */
function sources(): readonly [FakeSource, FakeSource, FakeSource] {
  return [new FakeSource("first"), new FakeSource("second"), new FakeSource("third")];
}

describe("string classification", () => {
  it("routes an absolute http or https URL to resolve and never to search", async () => {
    const [source] = sources();
    source.resolve.mockResolvedValue(media("first", "resolved"));
    const harness = setup([source]);

    const { items } = await harness.distube.play(TARGET, mediaUrl("resolved", "first"));

    expect(items[0]?.song.id).toBe("resolved");
    expect(source.resolve).toHaveBeenCalledTimes(1);
    expect(source.search).not.toHaveBeenCalled();
  });

  it.each(["a song title", "artist: song title", "c418:sweden", "spotify:track:abcdef", "10:30 remix"])(
    "treats %j as a query rather than a URL",
    async query => {
      const [source] = sources();
      source.search.mockResolvedValue([media("first", "candidate")]);
      const harness = setup([source]);

      const { items } = await harness.distube.play(TARGET, query);

      expect(source.search).toHaveBeenCalledWith(query, expect.objectContaining({ limit: 1 }));
      expect(source.resolve).not.toHaveBeenCalled();
      expect(items[0]?.song.id).toBe("candidate");
    },
  );

  it("rejects an empty or whitespace-only string before touching any source", async () => {
    const [source] = sources();
    const harness = setup([source]);

    await expect(harness.distube.play(TARGET, "   ")).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    expect(source.resolve).not.toHaveBeenCalled();
    expect(source.search).not.toHaveBeenCalled();
  });

  it("fails a URL every source declined instead of retrying it as a query", async () => {
    const [first, second] = sources();
    const harness = setup([first, second]);

    await expect(harness.distube.play(TARGET, "https://provider.example/unknown")).rejects.toMatchObject({
      code: ErrorCode.SOURCE_FAILED,
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

    const { items } = await harness.distube.play(TARGET, "a query");

    expect(items).toHaveLength(1);
    expect(items[0]?.song.id).toBe("wanted");
    expect(second.search).not.toHaveBeenCalled();
    expect(third.search).not.toHaveBeenCalled();
  });

  it("walks past sources that miss and consumes the first ranked candidate of the one that answers", async () => {
    const [first, second, third] = sources();
    third.search.mockResolvedValue([media("third", "wanted"), media("third", "ignored")]);
    const harness = setup([first, second, third]);

    const { items } = await harness.distube.play(TARGET, "a query");

    expect([first.search, second.search, third.search].map(spy => spy.mock.calls.length)).toEqual([1, 1, 1]);
    expect(items.map(item => item.song.id)).toEqual(["wanted"]);
  });

  it("records a mid-chain throw, continues, and keeps the failure out of the successful result", async () => {
    const [first, second, third] = sources();
    first.search.mockRejectedValue(new Error("provider down"));
    third.search.mockResolvedValue([media("third", "recovered")]);
    const harness = setup([first, second, third]);

    const { items } = await harness.distube.play(TARGET, "a query");

    expect(items[0]?.song.id).toBe("recovered");
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
      code: ErrorCode.SOURCE_FAILED,
      message: "No SourcePlugin found a result for the query",
    });
    // Only the sources that threw contribute a cause; the one that simply missed is not a failure.
    expect(failure.cause.errors).toEqual([down, refused]);
  });

  it("hands each source the chain's AbortSignal and stops the chain when it aborts", async () => {
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
    expect(first.search.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    controller.abort();
    held.reject(new Error("cancelled by provider"));

    expect(await play).toMatchObject({ code: ErrorCode.QUEUE_FAILED });
    expect(second.search).not.toHaveBeenCalled();
    expect(harness.distube.queues.size).toBe(0);
  });
});

describe("query entry points", () => {
  it("resolves a query through enqueue on a live queue", async () => {
    const [source] = sources();
    source.search.mockImplementation(async query => [media("first", query)]);
    const harness = setup([source]);
    const { queue } = await harness.distube.play(TARGET, "seed");
    await settle();

    const [item] = await queue.enqueue("follow up");

    expect(item?.song.id).toBe("follow up");
    expect(queue.state.items.map(queued => queued.song.id)).toEqual(["follow up"]);
  });

  it("resolves a query through resolve() without creating queue or voice state", async () => {
    const [source] = sources();
    source.search.mockResolvedValue([media("first", "standalone")]);
    const harness = setup([source]);

    await expect(harness.distube.resolve("a query")).resolves.toMatchObject({ id: "standalone" });

    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();
  });

  it("fences resolve() once shutdown has started", async () => {
    const [source] = sources();
    source.search.mockResolvedValue([media("first", "standalone")]);
    const harness = setup([source]);

    await harness.distube.shutdown();

    await expect(harness.distube.resolve("a query")).rejects.toMatchObject({
      code: ErrorCode.QUEUE_FAILED,
      message: "DisTube is shutting down",
    });
    expect(source.search).not.toHaveBeenCalled();
  });
});
