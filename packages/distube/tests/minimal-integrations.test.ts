import { Readable } from "node:stream";
import { inspect } from "node:util";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { DisTube, DisTubeError, type DisTubeQueue, type DisTubeVoice, Song } from "../src";
import type { Adapter, Engine, FilterDefinitionInfo, PlaybackResource, SourcePlugin } from "../src/integrations";
import { deferred, FakeAdapter, FakeEngine, FakeSource, settle } from "./support/harness";

const target = { guildId: "guild", id: "voice" };

function resolveOnly(name: string): SourcePlugin {
  return { name, resolve: async () => undefined, stream: async () => ({ kind: "search", query: "song" }) };
}

function readonlySet<Value>(values: Set<Value>): ReadonlySet<Value> {
  return Object.freeze({
    size: values.size,
    has: values.has.bind(values),
    forEach: values.forEach.bind(values),
    entries: values.entries.bind(values),
    keys: values.keys.bind(values),
    values: values.values.bind(values),
    union: values.union.bind(values),
    intersection: values.intersection.bind(values),
    difference: values.difference.bind(values),
    symmetricDifference: values.symmetricDifference.bind(values),
    isSubsetOf: values.isSubsetOf.bind(values),
    isSupersetOf: values.isSupersetOf.bind(values),
    isDisjointFrom: values.isDisjointFrom.bind(values),
    [Symbol.iterator]: values[Symbol.iterator].bind(values),
  });
}

function readonlyMap<Key, Value>(values: Map<Key, Value>): ReadonlyMap<Key, Value> {
  return Object.freeze({
    size: values.size,
    get: values.get.bind(values),
    has: values.has.bind(values),
    forEach: values.forEach.bind(values),
    entries: values.entries.bind(values),
    keys: values.keys.bind(values),
    values: values.values.bind(values),
    [Symbol.iterator]: values[Symbol.iterator].bind(values),
  });
}

describe("minimal integrations", () => {
  it("rejects unsupported kinds and formats without invoking the option predicate", async () => {
    const predicate = vi.fn(() => true);
    const engine = Object.assign(new FakeEngine(), {
      accepts: new Set(["encoded" as const]),
      encodedFormats: new Set(["supported.format"]),
      supportsResource: predicate,
    });
    const client = new DisTube({ adapter: new FakeAdapter(), sources: [], engine });
    const voice = await client.voices.join(target);
    for (const resource of [
      { kind: "url", url: "https://example.test/audio" },
      { kind: "encoded", format: "foreign.format", encoded: "private-data" },
    ] satisfies PlaybackResource[]) {
      await expect(voice.play(resource)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    }
    expect(predicate).not.toHaveBeenCalled();
    expect(engine.createPlayer).not.toHaveBeenCalled();
    await client.dispose();
  });

  it("rejects a reader for an engine that does not accept readers and disposes it once", async () => {
    const engine = new FakeEngine();
    const dispose = vi.fn();
    const read = vi.fn(() => Readable.from([]));
    const client = new DisTube({ adapter: new FakeAdapter(), sources: [], engine });
    const voice = await client.voices.join(target);

    await expect(voice.play({ kind: "reader", size: 10, container: "webm", read, dispose })).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });

    expect(dispose).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(engine.createPlayer).not.toHaveBeenCalled();
    await client.dispose();
  });

  it("redacts resource values from a throwing compatibility predicate and joins cleanup", async () => {
    const secret = "private-option-value";
    const dispose = vi.fn();
    const engine = Object.assign(new FakeEngine(), {
      supportsResource: () => {
        throw new DisTubeError("ENGINE_REJECTED", `Rejected ${secret}`, { cause: new Error(`Cause ${secret}`) });
      },
    });
    const client = new DisTube({ adapter: new FakeAdapter(), sources: [], engine });
    const voice = await client.voices.join(target);
    const failure = await voice
      .play({
        kind: "url",
        url: "https://example.test/audio",
        headers: { Authorization: secret },
        dispose,
      })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "ENGINE_REJECTED", cause: expect.any(Error) });
    expect(inspect(failure, { depth: 10 })).not.toContain(secret);
    expect(dispose).toHaveBeenCalledOnce();
    expect(engine.createPlayer).not.toHaveBeenCalled();
    await client.dispose();
  });

  it("snapshots the option predicate with its receiver and rejects before Player creation", async () => {
    const backing = new FakeEngine();
    const rejectedDispose = vi.fn();
    const original = vi.fn(function (this: Engine, resource: PlaybackResource) {
      expect(this).toBe(engine);
      expect(Object.isFrozen(resource)).toBe(true);
      return resource.kind === "url" && resource.headers === undefined;
    });
    const engine: Engine = {
      accepts: new Set(["url"]),
      capabilities: { seek: false },
      filters: new Map(),
      supportsResource: original,
      createPlayer: backing.createPlayer,
    };
    const client = new DisTube({ adapter: new FakeAdapter(), sources: [], engine });
    engine.supportsResource = () => true;
    const voice = await client.voices.join(target);
    await expect(
      voice.play({
        kind: "url",
        url: "https://example.test/audio",
        headers: { Authorization: "private" },
        dispose: rejectedDispose,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(rejectedDispose).toHaveBeenCalledOnce();
    expect(backing.createPlayer).not.toHaveBeenCalled();
    await voice.play({ kind: "url", url: "https://example.test/accepted" });
    expect(original).toHaveBeenCalledTimes(2);
    expect(backing.createPlayer).toHaveBeenCalledOnce();
    await client.dispose();
  });

  it("validates a supplied compatibility predicate before initialization", () => {
    const initialize = vi.fn();
    const engine = Object.assign(new FakeEngine(), { supportsResource: false, initialize });
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [], engine: engine as never })).toThrow(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
    expect(initialize).not.toHaveBeenCalled();
  });

  it("selects an explicit engine without reading the unused adapter default", async () => {
    const native = new FakeAdapter();
    const readDefault = vi.fn((): Engine => {
      throw new Error("unused default");
    });
    const adapter: Adapter = {
      normalizeTarget: native.normalizeTarget,
      createVoiceSession: native.createVoiceSession,
      get engine() {
        return readDefault();
      },
    };
    const client = new DisTube({ adapter, sources: [], engine: new FakeEngine() });
    expect(readDefault).not.toHaveBeenCalled();
    await client.voices.join(target);
    await client.dispose();
    expect(readDefault).not.toHaveBeenCalled();
  });

  it("accepts an adapter without a default and rejects the absence of either engine", async () => {
    const native = new FakeAdapter();
    const adapter: Adapter = { normalizeTarget: native.normalizeTarget, createVoiceSession: native.createVoiceSession };
    expect(() => new DisTube({ adapter, sources: [] })).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    const client = new DisTube({ adapter, sources: [], engine: new FakeEngine() });
    await client.dispose();
  });

  it("accepts structural readonly collections and snapshots them before initialization", async () => {
    const accepts = new Set<"url">(["url"]);
    const filters = new Map<string, FilterDefinitionInfo>([["bass", { acceptsValue: false, label: () => "Bass" }]]);
    const backing = new FakeEngine();
    const source = {
      ...resolveOnly("source"),
      initialize: () => {
        accepts.clear();
        filters.clear();
      },
    };
    const engine: Engine = {
      accepts: readonlySet(accepts),
      filters: readonlyMap(filters),
      capabilities: { seek: true },
      createPlayer: backing.createPlayer,
    };
    const client = new DisTube({ adapter: new FakeAdapter(), sources: [source], engine });
    const voice = await client.voices.join(target);
    expect(voice.capabilities.resourceKinds).toEqual(["url"]);
    expect(voice.filters.definitions.has("bass")).toBe(true);
    expect(Object.isFrozen(voice.capabilities)).toBe(true);
    await client.dispose();
  });

  it("validates discovery members and collection entries before any hook", () => {
    const entered = vi.fn();
    const source = { ...resolveOnly("source"), initialize: entered };
    const invalidSources = [
      { name: "invalid", stream: source.stream },
      { ...source, search: "not callable" },
      { ...source, related: false },
    ];
    for (const invalid of invalidSources) {
      expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [invalid as never] })).toThrow(
        expect.objectContaining({ code: "INVALID_ARGUMENT" }),
      );
    }
    const engine = Object.assign(new FakeEngine(), { accepts: readonlySet(new Set(["invalid"])) });
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [source], engine: engine as never })).toThrow(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
    expect(entered).not.toHaveBeenCalled();
  });

  it("permits independently optional hooks on sources and engines", async () => {
    const initialize = vi.fn();
    const disposeSource = vi.fn();
    const disposeEngine = vi.fn();
    const client = new DisTube({
      adapter: new FakeAdapter(),
      sources: [
        { ...resolveOnly("init"), initialize },
        { ...resolveOnly("dispose"), dispose: disposeSource },
      ],
      engine: Object.assign(new FakeEngine(), { dispose: disposeEngine }),
    });
    expect(initialize).toHaveBeenCalledOnce();
    await client.dispose();
    expect(disposeSource).toHaveBeenCalledOnce();
    expect(disposeEngine).toHaveBeenCalledOnce();
  });

  it("classifies malformed structural collection iteration before initialization", () => {
    const initialize = vi.fn();
    for (const entries of [
      () => [42][Symbol.iterator](),
      () => {
        throw new Error("broken iterator");
      },
    ]) {
      const filters = { ...readonlyMap(new Map()), [Symbol.iterator]: entries };
      const engine = Object.assign(new FakeEngine(), { filters });
      expect(
        () =>
          new DisTube({
            adapter: new FakeAdapter(),
            engine: engine as never,
            sources: [{ ...resolveOnly("source"), initialize }],
          }),
      ).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    }
    expect(initialize).not.toHaveBeenCalled();
  });

  it("classifies initializer failures at the plugin lifecycle boundary", () => {
    const failure = new DisTubeError("SOURCE_FAILED", "Provider initialization failed");
    const source = {
      ...resolveOnly("source"),
      initialize: () => {
        throw failure;
      },
    };
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [source] })).toThrow(
      expect.objectContaining({ code: "PLUGIN_FAILED", cause: failure }),
    );
  });

  it("reserves later integrations before a reentrant initializer can acquire them", async () => {
    const later = new FakeSource("later");
    const first = {
      ...resolveOnly("first"),
      initialize: () => {
        expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [later] })).toThrow(
          expect.objectContaining({ code: "INVALID_STATE" }),
        );
        throw new Error("initialization stopped");
      },
    };
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [first, later] })).toThrow(
      expect.objectContaining({ code: "PLUGIN_FAILED" }),
    );
    expect(later.initialize).not.toHaveBeenCalled();
    expect(later.dispose).not.toHaveBeenCalled();
    const next = new DisTube({ adapter: new FakeAdapter(), sources: [later] });
    await next.dispose();
  });

  it("rolls back every entered identity in reverse and retains ownership until cleanup settles", async () => {
    const gate = deferred<void>();
    const order: string[] = [];
    let fail = true;
    const first = {
      ...resolveOnly("first"),
      dispose: () => {
        order.push("first");
      },
    };
    const failing = {
      ...resolveOnly("failing"),
      initialize: () => {
        if (fail) throw new Error("failed init");
      },
      dispose: () => {
        order.push("failing");
        return gate.promise;
      },
    };
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [first, failing] })).toThrow(
      expect.objectContaining({ code: "PLUGIN_FAILED" }),
    );
    expect(order).toEqual(["failing", "first"]);
    await settle();
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [first] })).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
    gate.resolve();
    await settle();
    fail = false;
    const next = new DisTube({ adapter: new FakeAdapter(), sources: [first, failing] });
    await next.dispose();
  });

  it("infers a custom target through play, queue.voice, movement and events", async () => {
    type Target = { readonly room: string; readonly server: string };
    const native = new FakeAdapter();
    const adapter: Adapter<Target> = {
      normalizeTarget: value => ({ guildId: value.server, channelId: value.room }),
      createVoiceSession: native.createVoiceSession,
      engine: native.engine,
    };
    const source = new FakeSource("source");
    source.search.mockResolvedValue([
      new Song({ source: "source", id: "song", name: "Song", url: "https://example.test/song" }),
    ]);
    const client = new DisTube({ adapter, sources: [source] });
    client.on("voice.track.started", event => {
      expectTypeOf(event.voice).toEqualTypeOf<DisTubeVoice<Target>>();
    });
    client.on("queue.item.added", event => {
      expectTypeOf(event.queue).toEqualTypeOf<DisTubeQueue<unknown, Target>>();
    });
    const queue = await client.play({ room: "voice", server: "guild" }, "song");
    expectTypeOf(queue).toEqualTypeOf<DisTubeQueue<unknown, Target>>();
    await settle();
    expect(queue.voice).toBe(client.voices.get("guild"));
    await queue.voice?.move({ room: "next", server: "guild" });
    expect(native.sessions[0]?.channelId).toBe("next");
    await client.dispose();
  });
});
