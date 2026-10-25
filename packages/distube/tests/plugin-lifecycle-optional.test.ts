import { describe, expect, it, vi } from "vitest";
import { DisTubeError, type Playlist, type Song } from "../src";
import type { Plugin } from "../src/integrations";
import { FakeEngine, FakeSource, GUILD, media, settle, setup, VOICE_CHANNEL } from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

function minimal(name: string, hits: readonly string[] = []): Plugin {
  return {
    name,
    search: async (query: string) => hits.filter(hit => hit === query).map(hit => media(name, hit)),
    resolve: async (): Promise<Song | Playlist | undefined> => undefined,
    stream: async (song: Song) => ({ kind: "url" as const, url: `https://stream.example/${song.id}` }),
  };
}

describe("optional plugin members", () => {
  it("constructs, plays through and disposes a plugin with only the members it needs", async () => {
    const harness = setup([minimal("bare", ["a"])]);
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    expect(queue.current?.song.id).toBe("a");
    expect(harness.engine.player.playing).toBe("a");
    await expect(harness.distube.dispose()).resolves.toBeUndefined();
  });

  it("disposes every plugin once in reverse order, an engine plugin included", async () => {
    const order: string[] = [];
    const first = new FakeSource("A");
    const second = new FakeSource("B");
    const remote: Plugin = { name: "E", engine: new FakeEngine(), dispose: () => void order.push("E") };
    first.dispose.mockImplementation(() => void order.push("A"));
    second.dispose.mockImplementation(() => void order.push("B"));
    const harness = setup([first, remote, second]);
    await harness.distube.dispose();
    await harness.distube.dispose();
    expect(order).toEqual(["B", "E", "A"]);
  });
});

describe("search and suggestions", () => {
  it("searches one configured source or the first non-empty result in constructor order", async () => {
    const first = minimal("first");
    const second = minimal("second", ["lofi"]);
    const harness = setup([first, second]);
    const searchSpy = vi.spyOn(second, "search");

    const ranked = await harness.distube.search("lofi");
    expect(ranked.map(song => song.id)).toEqual(["lofi"]);
    expect(ranked[0]?.source).toBe("second");
    expect(searchSpy).toHaveBeenCalledWith("lofi", expect.objectContaining({ signal: expect.any(AbortSignal) }));

    const only = await harness.distube.search("lofi", { source: second, limit: 3, offset: 1 });
    expect(searchSpy).toHaveBeenLastCalledWith("lofi", expect.objectContaining({ limit: 3, offset: 1 }));
    expect(only.map(song => song.id)).toEqual(["lofi"]);
    expect(await harness.distube.search("zzzz")).toEqual([]);
    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
    await harness.distube.dispose();
  });

  it("rejects a foreign source instance and malformed queries or pagination before consulting any source", async () => {
    const configured = new FakeSource("configured");
    const foreign = new FakeSource("foreign");
    const harness = setup([configured]);
    await expect(harness.distube.search("q", { source: foreign })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.suggest("q", { source: foreign })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.search("   ")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.search("q", { limit: 0 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.search("q", { offset: -1 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(foreign.search).not.toHaveBeenCalled();
    expect(configured.search).not.toHaveBeenCalled();
    await harness.distube.dispose();
  });

  it("treats a source without suggest as a decline and caps the first non-empty list at 25", async () => {
    const silent = minimal("silent");
    const many = { ...minimal("many"), suggest: vi.fn(async () => Array.from({ length: 30 }, (_, i) => `s${i}`)) };
    const harness = setup([silent, many]);

    expect(await harness.distube.suggest("lo", { source: silent })).toEqual([]);
    const suggestions = await harness.distube.suggest("lo");
    expect(suggestions).toHaveLength(25);
    expect(suggestions[0]).toBe("s0");
    expect(many.suggest).toHaveBeenCalledWith("lo", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await harness.distube.dispose();
  });

  it("rejects ABORTED for an already-aborted signal and INVALID_STATE after dispose", async () => {
    const source = { ...minimal("source", ["a"]), suggest: vi.fn(async () => ["a"]) };
    const harness = setup([source]);
    const controller = new AbortController();
    controller.abort("cancelled");
    const options = { signal: controller.signal };
    await expect(harness.distube.search("a", options)).rejects.toMatchObject({ code: "ABORTED" });
    await expect(harness.distube.suggest("a", options)).rejects.toMatchObject({ code: "ABORTED" });
    expect(source.suggest).not.toHaveBeenCalled();

    await harness.distube.dispose();
    await expect(harness.distube.search("a")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(harness.distube.suggest("a")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("wraps an unexpected search or suggest failure as SOURCE_FAILED once and passes a DisTubeError through", async () => {
    const first = new FakeSource("first");
    const second = new FakeSource("second");
    const harness = setup([first, second]);
    const boom = new Error("provider down");
    first.search.mockRejectedValueOnce(boom);
    await expect(harness.distube.search("x")).rejects.toMatchObject({ code: "SOURCE_FAILED", cause: boom });
    first.search.mockRejectedValueOnce(boom);
    await expect(harness.distube.search("x", { source: first })).rejects.toMatchObject({
      code: "SOURCE_FAILED",
      cause: boom,
    });
    // A source that already speaks DisTubeError keeps its identity, including a plugin-owned code.
    const owned = new DisTubeError("RATE_LIMITED", "slow down");
    first.search.mockRejectedValueOnce(owned);
    await expect(harness.distube.search("x")).rejects.toBe(owned);
    expect(second.search).not.toHaveBeenCalled();

    const suggesting = { ...minimal("suggesting"), suggest: vi.fn(async () => [] as readonly string[]) };
    const other = setup([suggesting]);
    suggesting.suggest.mockRejectedValueOnce(boom);
    await expect(other.distube.suggest("lo")).rejects.toMatchObject({ code: "SOURCE_FAILED", cause: boom });
    suggesting.suggest.mockRejectedValueOnce(owned);
    await expect(other.distube.suggest("lo", { source: suggesting })).rejects.toBe(owned);
    await harness.distube.dispose();
    await other.distube.dispose();
  });

  it("rejects NO_RESULT when every source declines a play query", async () => {
    const harness = setup([minimal("first"), minimal("second")]);
    await expect(harness.distube.play(TARGET, "nothing")).rejects.toMatchObject({ code: "NO_RESULT" });
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    await harness.distube.dispose();
  });
});
