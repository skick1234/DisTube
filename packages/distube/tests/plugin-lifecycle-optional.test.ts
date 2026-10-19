import { describe, expect, it, vi } from "vitest";
import { DisTube, DisTubeError, type Playlist, type Song } from "../src";
import type { PluginContext, SourceOperationOptions, SourcePlugin } from "../src/integrations";
import { FakeAdapter, FakeEngine, FakeSource, GUILD, media, settle, setup, VOICE_CHANNEL } from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

/** A SourcePlugin with only the four required members. */
function minimal(name: string, hits: readonly string[] = []): SourcePlugin {
  return {
    name,
    search: async (query: string) => hits.filter(hit => hit === query).map(hit => media(name, hit)),
    resolve: async (): Promise<Song | Playlist | undefined> => undefined,
    stream: async (song: Song) => ({
      kind: "resource" as const,
      resource: { kind: "url" as const, url: `https://stream.example/${song.id}`, dispose: () => undefined },
    }),
  };
}

describe("optional plugin lifecycle", () => {
  it("constructs, plays through and disposes a source with only the required members", async () => {
    const harness = setup([minimal("bare", ["a"])]);
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    expect(queue.current?.song.id).toBe("a");
    expect(harness.engine.players[0]?.playing).toBe(queue.current?.id);
    await expect(harness.distube.dispose()).resolves.toBeUndefined();
  });

  it("calls a present initialize once with a PluginContext and a present dispose once", async () => {
    const source = new FakeSource("hooked");
    const harness = setup([source]);
    expect(source.initialize).toHaveBeenCalledTimes(1);
    const context = source.initialize.mock.calls[0]?.[0] as PluginContext;
    expect(typeof context.diagnostic).toBe("function");
    context.diagnostic({ severity: "info", stage: "test", message: "hello" });
    expect(harness.diagnostics).toHaveBeenCalledWith(expect.objectContaining({ plugin: "hooked", stage: "test" }));
    await harness.distube.dispose();
    await harness.distube.dispose();
    expect(source.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "initializes in constructor order and disposes in reverse with dual-role engine=%s",
    async dualRole => {
      const order: string[] = [];
      const first = new FakeSource("A");
      const second = new FakeSource("B");
      const engine = Object.assign(new FakeEngine(), minimal("E"), {
        initialize: vi.fn(() => {
          order.push("initialize:E");
        }),
        dispose: vi.fn(() => {
          order.push("dispose:E");
        }),
      });
      first.initialize.mockImplementation(() => {
        order.push("initialize:A");
      });
      second.initialize.mockImplementation(() => {
        order.push("initialize:B");
      });
      first.dispose.mockImplementation(() => {
        order.push("dispose:A");
      });
      second.dispose.mockImplementation(() => {
        order.push("dispose:B");
      });
      const harness = setup(dualRole ? [first, second, engine] : [first, second], { engine });
      expect(order).toEqual(["initialize:A", "initialize:B", "initialize:E"]);

      await harness.distube.dispose();
      await harness.distube.dispose();
      expect(order).toEqual(["initialize:A", "initialize:B", "initialize:E", "dispose:E", "dispose:B", "dispose:A"]);
      expect(engine.initialize).toHaveBeenCalledTimes(1);
      expect(engine.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a present hook that is not callable and an instance owned by another live client", () => {
    const adapter = new FakeAdapter();
    const broken = { ...minimal("broken"), initialize: "later" as never };
    expect(() => new DisTube({ adapter, sources: [broken] })).toThrow(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
    const shared = minimal("shared");
    const first = new DisTube({ adapter, sources: [shared] });
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [shared] })).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
    void first.dispose();
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
    await expect(harness.distube.getSuggestions("q", foreign)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
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

    expect(await harness.distube.getSuggestions("lo", silent)).toEqual([]);
    const suggestions = await harness.distube.getSuggestions("lo");
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
    const options: SourceOperationOptions = { signal: controller.signal };
    await expect(harness.distube.search("a", options)).rejects.toMatchObject({ code: "ABORTED" });
    await expect(harness.distube.getSuggestions("a", undefined, options)).rejects.toMatchObject({ code: "ABORTED" });
    expect(source.suggest).not.toHaveBeenCalled();

    await harness.distube.dispose();
    await expect(harness.distube.search("a")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(harness.distube.getSuggestions("a")).rejects.toMatchObject({ code: "INVALID_STATE" });
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
    const owned = new DisTubeError("FIRST_RATE_LIMITED", "slow down");
    first.search.mockRejectedValueOnce(owned);
    await expect(harness.distube.search("x")).rejects.toBe(owned);
    expect(second.search).not.toHaveBeenCalled();

    const suggesting = { ...minimal("suggesting"), suggest: vi.fn(async () => [] as readonly string[]) };
    const other = setup([suggesting]);
    suggesting.suggest.mockRejectedValueOnce(boom);
    await expect(other.distube.getSuggestions("lo")).rejects.toMatchObject({ code: "SOURCE_FAILED", cause: boom });
    suggesting.suggest.mockRejectedValueOnce(owned);
    await expect(other.distube.getSuggestions("lo", suggesting)).rejects.toBe(owned);
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
