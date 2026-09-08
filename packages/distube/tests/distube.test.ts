import { describe, expect, it, vi } from "vitest";
import { DisTube, DisTubeError, type Song } from "../src";
import type { PluginContext } from "../src/integrations";
import { resolveInput } from "../src/playback/resolve";
import { findCandidates, newSearchChain } from "../src/playback/search";
import { createSourceCatalog } from "../src/playback/sources";
import {
  capture,
  deferred,
  FakeAdapter,
  FakeEngine,
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

/** An engine with lifecycle hooks, supplied explicitly in client options. */
class FakeEnginePlugin extends FakeEngine {
  readonly initialize = vi.fn((_context: PluginContext) => undefined);
  readonly dispose = vi.fn(() => undefined);

  constructor(readonly name = "engine") {
    super();
  }
}

describe("client construction", () => {
  it.each([
    [undefined, "DisTube options are required"],
    [{ adapter: {}, sources: [] }, "options.adapter must implement Adapter"],
    [{ adapter: new FakeAdapter(), sources: {} }, "options.sources must be an array"],
    [{ adapter: new FakeAdapter(), sources: [{}] }, "Each source must implement SourcePlugin"],
    [{ adapter: new FakeAdapter(), sources: [], engine: {} }, "options.engine must implement Engine"],
    [{ adapter: new FakeAdapter(), sources: [], unexpected: true }, "Unknown DisTube option"],
  ] as const)("rejects invalid construction options %#", (options, message) => {
    expect(() => new DisTube(options as never)).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT", message }),
    );
  });

  it("rejects duplicate source names before initializing any", () => {
    const first = new FakeSource("duplicate");
    const second = new FakeSource("duplicate");
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [first, second] })).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT", message: "Duplicate source name" }),
    );
    expect(first.initialize).not.toHaveBeenCalled();
  });

  it("uses the explicitly selected engine instead of the adapter default", async () => {
    const source = new FakeSource("source");
    source.search.mockImplementation(async query => [media("source", query)]);
    const selected = new FakeEnginePlugin();
    const adapter = new FakeAdapter();
    const distube = new DisTube({ adapter, sources: [source], engine: selected });
    await distube.play(TARGET, "a");
    await settle();
    expect(selected.players).toHaveLength(1);
    expect((adapter.engine as FakeEngine).players).toHaveLength(0);
    expect(selected.initialize).toHaveBeenCalledTimes(1);
    await distube.dispose();
    expect(selected.dispose).toHaveBeenCalledTimes(1);
  });

  it("rolls back initialized plugins in reverse order and classifies the failure", () => {
    const first = new FakeSource("first");
    const second = new FakeSource("second");
    second.initialize.mockImplementation(() => {
      throw new Error("init failed");
    });

    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [first, second] })).toThrowError(
      expect.objectContaining({ code: "PLUGIN_FAILED" }),
    );
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it("preserves initialization failure when rollback disposal throws synchronously", () => {
    const first = new FakeSource("first");
    const second = new FakeSource("second");
    const failing = new FakeSource("failing");
    const initializationFailure = new Error("initialization failed");
    const disposalFailure = new Error("synchronous rollback disposal failed");
    const diagnostics = vi.fn();
    failing.initialize.mockImplementation(() => {
      throw initializationFailure;
    });
    second.dispose.mockImplementation(() => {
      throw disposalFailure;
    });

    let failure: unknown;
    try {
      new DisTube({ adapter: new FakeAdapter(), sources: [first, second, failing], onDiagnostic: diagnostics });
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: "PLUGIN_FAILED", cause: initializationFailure });
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(failing.dispose).not.toHaveBeenCalled();
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "plugin.initialize.rollback",
        plugin: "second",
        error: disposalFailure,
      }),
    );
  });

  it("reports late initialization and rollback rejections without hiding the construction error", async () => {
    const initialized = new FakeSource("initialized");
    const asynchronous = new FakeSource("asynchronous");
    const diagnostics = vi.fn();
    initialized.dispose.mockRejectedValueOnce(new Error("rollback failed"));
    asynchronous.initialize.mockImplementation((() => Promise.reject("late failure")) as unknown as () => undefined);

    expect(
      () =>
        new DisTube({ adapter: new FakeAdapter(), sources: [initialized, asynchronous], onDiagnostic: diagnostics }),
    ).toThrowError(expect.objectContaining({ code: "PLUGIN_FAILED" }));
    await settle();

    expect(initialized.dispose).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "plugin.initialize.late-rejection",
        plugin: "asynchronous",
        error: expect.objectContaining({ message: "Operation failed with a non-Error value" }),
      }),
    );
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "plugin.initialize.rollback",
        plugin: "initialized",
        error: expect.objectContaining({ message: "rollback failed" }),
      }),
    );
  });
});

describe("source routing", () => {
  it("resolves media without creating queue or voice state and gives sources cancellable signals", async () => {
    const harness = playableSetup();
    const controller = new AbortController();

    await expect(harness.distube.resolve(mediaUrl("first"))).resolves.toMatchObject({ id: "first" });
    const generatedSignal = harness.source.resolve.mock.calls[0]?.[1]?.signal;
    await expect(harness.distube.resolve(mediaUrl("second"), { signal: controller.signal })).resolves.toMatchObject({
      id: "second",
    });
    const callerSignal = harness.source.resolve.mock.calls[1]?.[1]?.signal;

    expect(generatedSignal).toBeInstanceOf(AbortSignal);
    expect(generatedSignal).not.toBe(controller.signal);
    expect(callerSignal).toBeInstanceOf(AbortSignal);
    expect(callerSignal).not.toBe(controller.signal);
    expect(callerSignal?.aborted).toBe(false);
    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
  });

  it("aborts an in-flight standalone resolution before it consults another source at shutdown", async () => {
    const first = new FakeSource("first");
    const second = new FakeSource("second");
    const response = deferred<Song | undefined>();
    first.resolve.mockReturnValueOnce(response.promise);
    const harness = setup([first, second]);
    const resolving = capture(harness.distube.resolve(mediaUrl("race")));

    await settle();
    expect(first.resolve).toHaveBeenCalledTimes(1);
    const shutdown = harness.distube.dispose();
    response.resolve(undefined);

    expect(await resolving).toMatchObject({ code: "INVALID_STATE" });
    expect(second.resolve).not.toHaveBeenCalled();
    await shutdown;
  });

  it("fences a reentrant resolution started by an aborting source", async () => {
    const first = new FakeSource("first");
    const harness = setup([first]);
    const reentered = deferred<Error>();
    first.resolve.mockImplementation(
      (_url, options) =>
        new Promise(resolve => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              void harness.distube.resolve(mediaUrl("reentrant")).then(
                () => reentered.reject(new Error("reentrant resolution unexpectedly succeeded")),
                error => reentered.resolve(error as Error),
              );
              resolve(undefined);
            },
            { once: true },
          );
        }),
    );
    const resolving = capture(harness.distube.resolve(mediaUrl("first")));

    await settle();
    const shutdown = harness.distube.dispose();

    expect(await resolving).toMatchObject({ code: "INVALID_STATE" });
    await expect(reentered.promise).resolves.toMatchObject({ code: "INVALID_STATE" });
    expect(first.resolve).toHaveBeenCalledTimes(1);
    await shutdown;
  });

  it("stops pre-aborted URL and search resolution before either source loop", async () => {
    const source = new FakeSource("source");
    const catalog = createSourceCatalog([source]);
    const urlController = new AbortController();
    urlController.abort(new Error("URL cancelled"));

    await expect(resolveInput(mediaUrl("cancelled"), catalog, urlController.signal)).rejects.toMatchObject({
      code: "ABORTED",
    });

    const searchController = new AbortController();
    searchController.abort(new Error("search cancelled"));
    await expect(
      findCandidates("cancelled", catalog, searchController.signal, newSearchChain(), 1),
    ).rejects.toMatchObject({
      code: "ABORTED",
    });

    expect(source.resolve).not.toHaveBeenCalled();
    expect(source.search).not.toHaveBeenCalled();
  });

  it("passes a declined URL to the next configured source", async () => {
    const first = new FakeSource("first");
    const second = new FakeSource("second");
    second.resolve.mockImplementation(async url => media("second", url));
    const harness = setup([first, second]);

    const { items } = await harness.distube.play(TARGET, "https://provider.example/item");

    expect(first.resolve).toHaveBeenCalledTimes(1);
    expect(items[0]?.song.source).toBe("second");
  });

  it("rejects malformed resolve results before standalone resolution or queue insertion", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "seed");
    await settle();
    const added = vi.fn();
    harness.distube.on("queue.item.added", added);
    const malformed = [[media("source", "array")], null, { id: "object" }, false] as const;

    for (const result of malformed) {
      harness.source.resolve.mockResolvedValueOnce(result as never);
      await expect(harness.distube.resolve(mediaUrl("malformed"))).rejects.toMatchObject({
        code: "SOURCE_FAILED",
        message: expect.stringContaining("source"),
      });
    }

    harness.source.resolve.mockResolvedValueOnce(malformed[0] as never);
    await expect(queue.enqueue(mediaUrl("malformed"))).rejects.toMatchObject({
      code: "SOURCE_FAILED",
      message: expect.stringContaining("source"),
    });
    expect(added).not.toHaveBeenCalled();
    expect(queue.state.upcoming).toEqual([]);
  });

  it("maps a source failure to SOURCE_FAILED, keeping an incompatible DisTubeError as the cause", async () => {
    const harness = playableSetup();
    const cause = new DisTubeError("VOICE_FAILED", "wrong subsystem");
    harness.source.resolve.mockRejectedValueOnce(cause);

    await expect(harness.distube.play(TARGET, "https://provider.example/item")).rejects.toMatchObject({
      code: "SOURCE_FAILED",
      cause,
    });
  });
});

describe("event facade", () => {
  it("returns an idempotent unsubscribe for each registration", async () => {
    const harness = playableSetup();
    const listener = vi.fn();
    const unsubscribe = harness.distube.on("queue.item.added", listener);
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribe();
    await queue.enqueue("b");
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    await harness.distube.dispose();
  });

  it("reports a failing listener as a diagnostic without rolling back the transition", async () => {
    const harness = playableSetup();
    harness.distube.on("queue.item.added", async () => {
      throw new Error("listener failed");
    });

    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();

    expect(queue.state.current?.song.id).toBe("a");
    expect(harness.diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "error", stage: "event.listener", error: expect.any(Error) }),
    );
  });

  it("isolates a diagnostic consumer that rejects", async () => {
    const source = new FakeSource("source");
    source.initialize.mockImplementation(context => {
      context.diagnostic({ severity: "info", stage: "plugin.initialize", message: "ready" });
    });
    const onDiagnostic = vi.fn(async () => {
      throw new Error("diagnostic consumer failed");
    });

    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [source], onDiagnostic })).not.toThrow();
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "plugin.initialize", plugin: "source", message: "ready" }),
    );
    await settle();
  });
});

describe("shutdown", () => {
  it("memoizes the shutdown, disposes each Plugin once, and fences later play", async () => {
    const harness = playableSetup();
    const first = harness.distube.dispose();

    expect(harness.distube.dispose()).toBe(first);
    await first;
    expect(harness.source.dispose).toHaveBeenCalledTimes(1);
    await expect(harness.distube.play(TARGET, "a")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("stops the borrowed Player and ignores the outcomes it publishes afterwards", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.players[0];
    const item = queue.state.current;
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", failed);

    await harness.distube.dispose();

    expect(player?.stopTrack).toHaveBeenCalled();
    expect(player?.listeners.size).toBe(0);
    player?.emit({ type: "failed", itemId: item?.id ?? "missing", error: new Error("late") });
    expect(failed).not.toHaveBeenCalled();
  });

  it("classifies a DisTubeVoice-only cleanup failure", async () => {
    const harness = playableSetup();
    await harness.distube.voices.join(TARGET);
    harness.adapter.sessions[0]?.release.mockRejectedValueOnce(new Error("session release failed"));

    await expect(harness.distube.dispose()).rejects.toMatchObject({
      code: "VOICE_FAILED",
      cause: expect.any(AggregateError),
    });
  });

  it("flattens nested Plugin cleanup causes and attempts every disposal", async () => {
    const first = new FakeSource("first");
    const second = new FakeSource("second");
    const third = new FakeSource("third");
    first.dispose.mockImplementation(() => {
      throw new Error("raw failure");
    });
    second.dispose.mockImplementation(() => {
      throw new DisTubeError("PLUGIN_FAILED", "nested failure", {
        cause: new AggregateError([new Error("nested leaf"), "string leaf"]),
      });
    });
    third.dispose.mockImplementation(() => {
      throw new DisTubeError("PLUGIN_FAILED", "missing cause");
    });
    const distube = new DisTube({ adapter: new FakeAdapter(), sources: [first, second, third] });

    const failure = (await capture(distube.dispose())) as DisTubeError;

    expect(failure.code).toBe("PLUGIN_FAILED");
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors.map(error => (error as Error).message)).toEqual(
      expect.arrayContaining([
        "raw failure",
        "nested leaf",
        "Operation failed with a non-Error value",
        "missing cause",
      ]),
    );
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(third.dispose).toHaveBeenCalledTimes(1);
  });

  it("attempts every disposal and preserves each cause in one aggregate", async () => {
    const first = new FakeSource("source");
    first.search.mockImplementation(async query => [media("source", query)]);
    first.preparePlayback.mockImplementation(async song => ({
      kind: "resource",
      resource: {
        kind: "url",
        url: mediaUrl(song.id),
        dispose: () => undefined,
      },
    }));
    const second = new FakeSource("second");
    const harness = setup([first, second]);
    first.dispose.mockImplementation(() => {
      throw new Error("plugin dispose failed");
    });
    second.dispose.mockImplementation(() => {
      throw new Error("second dispose failed");
    });
    await harness.distube.play(TARGET, "a");
    await settle();
    harness.engine.players[0]?.stopTrack.mockRejectedValue(new Error("stop failed"));
    const failure = (await capture(harness.distube.dispose())) as DisTubeError;
    expect(failure).toBeInstanceOf(DisTubeError);
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors.map(error => (error as Error).message)).toEqual(
      expect.arrayContaining(["stop failed", "plugin dispose failed", "second dispose failed"]),
    );
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("cancellation", () => {
  it("rejects an aborted enqueue with QUEUE_FAILED, keeping an Error reason as the cause", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const controller = new AbortController();
    const reason = new Error("caller went away");
    const resolution = deferred<Song>();
    harness.source.resolve.mockImplementationOnce(async () => resolution.promise);

    const enqueueing = capture(queue.enqueue("b", { signal: controller.signal }));
    controller.abort(reason);
    resolution.resolve(media("source", "b"));
    const failure = (await enqueueing) as DisTubeError;

    expect(failure).toBeInstanceOf(DisTubeError);
    expect(failure).not.toBe(reason);
    expect(failure.code).toBe("ABORTED");
    expect(failure.cause).toBe(reason);
    expect(queue.state.upcoming).toEqual([]);
    await harness.distube.dispose();
  });

  it("wraps a caller-supplied DisTubeError abort reason in a distinct error", async () => {
    const harness = playableSetup();
    const controller = new AbortController();
    const reason = new DisTubeError("INVALID_STATE", "caller cancelled");
    controller.abort(reason);

    const failure = (await capture(
      harness.distube.resolve("https://provider.example/a", { signal: controller.signal }),
    )) as DisTubeError;

    expect(failure).toBeInstanceOf(DisTubeError);
    expect(failure).not.toBe(reason);
    expect(failure.code).toBe("ABORTED");
    expect(failure.cause).toBe(reason);
    expect(harness.source.resolve).not.toHaveBeenCalled();
    await harness.distube.dispose();
  });

  it("produces no cause when the abort reason is not an Error", async () => {
    const harness = playableSetup();
    const controller = new AbortController();
    controller.abort("just a string");

    const failure = (await capture(
      harness.distube.resolve("https://provider.example/a", { signal: controller.signal }),
    )) as DisTubeError;

    expect(failure.code).toBe("ABORTED");
    expect(failure.cause).toBeUndefined();
    await harness.distube.dispose();
  });
});
