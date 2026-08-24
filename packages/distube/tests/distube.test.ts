import { describe, expect, it, vi } from "vitest";
import { DisTube, DisTubeError, ErrorCode, type Plugin, type PluginContext, type Song } from "../src";
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

const TARGET = { guildId: GUILD, voiceChannelId: VOICE_CHANNEL };

/** A Plugin that also satisfies the Engine members, so the client adopts it over the Adapter's. */
class FakeEnginePlugin extends FakeEngine implements Plugin {
  readonly initialize = vi.fn((_context: PluginContext) => undefined);
  readonly dispose = vi.fn(() => undefined);

  constructor(readonly name = "engine") {
    super();
  }
}

describe("client construction", () => {
  it.each([
    [undefined, "DisTube options are required"],
    [{ adapter: {}, plugins: [] }, "options.adapter must implement Adapter"],
    [{ adapter: new FakeAdapter(), plugins: {} }, "options.plugins must be an array"],
    [{ adapter: new FakeAdapter(), plugins: [{}] }, "Each plugin must implement Plugin"],
    [{ adapter: new FakeAdapter(), plugins: [], unexpected: true }, "Unknown option: unexpected"],
  ] as const)("rejects invalid construction options %#", (options, message) => {
    expect(() => new DisTube(options as never)).toThrowError(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT, message }),
    );
  });

  it("does not adopt a Plugin that omits the declared resource kinds an Engine owes", async () => {
    const source = new FakeSource("source");
    source.search.mockImplementation(async query => [media("source", query)]);
    const undeclared = new FakeEnginePlugin("undeclared") as unknown as { accepts?: unknown };
    // Detection is structural, so a Plugin missing `accepts` is simply not an Engine.
    delete undeclared.accepts;
    const adapter = new FakeAdapter();
    const distube = new DisTube({ adapter, plugins: [source, undeclared as unknown as Plugin] });

    await distube.play(TARGET, "a");
    await settle();

    expect((undeclared as unknown as FakeEnginePlugin).players).toHaveLength(0);
    expect((adapter.engine as FakeEngine).players).toHaveLength(1);
  });

  it("rejects a duplicate Plugin and a second engine-capable Plugin before initializing any", () => {
    const first = new FakeSource("duplicate");
    const second = new FakeSource("duplicate");
    expect(() => new DisTube({ adapter: new FakeAdapter(), plugins: [first, second] })).toThrowError(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT, message: "Duplicate Plugin: duplicate" }),
    );
    expect(first.initialize).not.toHaveBeenCalled();

    expect(
      () => new DisTube({ adapter: new FakeAdapter(), plugins: [new FakeEnginePlugin("one"), new FakeEnginePlugin()] }),
    ).toThrowError(expect.objectContaining({ message: "Only one engine-capable Plugin is allowed: engine" }));
  });

  it("prefers an engine Plugin over the Adapter's engine", async () => {
    const source = new FakeSource("source");
    source.search.mockImplementation(async query => [media("source", query)]);
    const plugged = new FakeEnginePlugin();
    const adapter = new FakeAdapter();
    const distube = new DisTube({ adapter, plugins: [source, plugged] });

    await distube.play(TARGET, "a");
    await settle();

    expect(plugged.players).toHaveLength(1);
    expect((adapter.engine as FakeEngine).players).toHaveLength(0);
  });

  it("rolls back initialized plugins in reverse order and classifies the failure", () => {
    const first = new FakeSource("first");
    const second = new FakeSource("second");
    second.initialize.mockImplementation(() => {
      throw new Error("init failed");
    });

    expect(() => new DisTube({ adapter: new FakeAdapter(), plugins: [first, second] })).toThrowError(
      expect.objectContaining({ code: ErrorCode.PLUGIN_FAILED }),
    );
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it("reports late initialization and rollback rejections without hiding the construction error", async () => {
    const initialized = new FakeSource("initialized");
    const asynchronous = new FakeSource("asynchronous");
    const diagnostics = vi.fn();
    initialized.dispose.mockRejectedValueOnce(new Error("rollback failed"));
    asynchronous.initialize.mockImplementation((() => Promise.reject("late failure")) as unknown as () => undefined);

    expect(
      () =>
        new DisTube({ adapter: new FakeAdapter(), plugins: [initialized, asynchronous], onDiagnostic: diagnostics }),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.PLUGIN_FAILED }));
    await settle();

    expect(initialized.dispose).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "plugin.initialize.late-rejection",
        plugin: "asynchronous",
        error: expect.objectContaining({ message: "late failure" }),
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
  it("resolves media without creating queue or voice state and preserves a caller signal", async () => {
    const harness = playableSetup();
    const controller = new AbortController();

    await expect(harness.distube.resolve(mediaUrl("first"))).resolves.toMatchObject({ id: "first" });
    const generatedSignal = harness.source.resolve.mock.calls[0]?.[1]?.signal;
    await expect(harness.distube.resolve(mediaUrl("second"), { signal: controller.signal })).resolves.toMatchObject({
      id: "second",
    });

    expect(generatedSignal).toBeInstanceOf(AbortSignal);
    expect(generatedSignal).not.toBe(controller.signal);
    expect(harness.source.resolve.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
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

  it("maps a source failure to SOURCE_FAILED, keeping an incompatible DisTubeError as the cause", async () => {
    const harness = playableSetup();
    const cause = new DisTubeError(ErrorCode.VOICE_FAILED, "wrong subsystem");
    harness.source.resolve.mockRejectedValueOnce(cause);

    await expect(harness.distube.play(TARGET, "https://provider.example/item")).rejects.toMatchObject({
      code: ErrorCode.SOURCE_FAILED,
      cause,
    });
  });
});

describe("event facade", () => {
  it("forwards on, once, and off to the underlying emitter", async () => {
    const harness = playableSetup();
    const persistent = vi.fn();
    const once = vi.fn();
    harness.distube.on("queue.item.added", persistent).once("queue.item.added", once);
    harness.distube.off("queue.item.added", persistent);

    const { queue } = await harness.distube.play(TARGET, "a");
    await queue.enqueue("b");

    expect(persistent).not.toHaveBeenCalled();
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("removes a client once listener through off, and clears the rest through removeAllListeners", async () => {
    const harness = playableSetup();
    const once = vi.fn();
    const persistent = vi.fn();
    harness.distube.once("queue.item.added", once).on("queue.item.added", persistent);
    // `off` is given the caller's own function, not the wrapper `once` actually registered.
    expect(harness.distube.off("queue.item.added", once)).toBe(harness.distube);

    const { queue } = await harness.distube.play(TARGET, "a");
    expect(once).not.toHaveBeenCalled();
    expect(persistent).toHaveBeenCalledTimes(1);

    expect(harness.distube.removeAllListeners()).toBe(harness.distube);
    await queue.enqueue("b");
    expect(persistent).toHaveBeenCalledTimes(1);
    await harness.distube.shutdown();
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

    expect(() => new DisTube({ adapter: new FakeAdapter(), plugins: [source], onDiagnostic })).not.toThrow();
    expect(onDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "plugin.initialize", plugin: "source", message: "ready" }),
    );
    await settle();
  });
});

describe("shutdown", () => {
  it("memoizes the shutdown, disposes each Plugin once, and fences later play", async () => {
    const harness = playableSetup();
    const first = harness.distube.shutdown();

    expect(harness.distube.shutdown()).toBe(first);
    await first;
    expect(harness.source.dispose).toHaveBeenCalledTimes(1);
    await expect(harness.distube.play(TARGET, "a")).rejects.toMatchObject({ code: ErrorCode.QUEUE_FAILED });
  });

  it("stops the borrowed Player and ignores the outcomes it publishes afterwards", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.players[0];
    const item = queue.state.current;
    const failed = vi.fn();
    harness.distube.on("queue.item.failed", failed);

    await harness.distube.shutdown();

    expect(player?.stopTrack).toHaveBeenCalled();
    expect(player?.listeners.size).toBe(0);
    player?.emit({ type: "failed", itemId: item?.id ?? "missing", error: new Error("late") });
    expect(failed).not.toHaveBeenCalled();
  });

  it("classifies a Voice-only cleanup failure", async () => {
    const harness = playableSetup();
    await harness.distube.voices.join({ guildId: GUILD, channelId: VOICE_CHANNEL });
    harness.adapter.sessions[0]?.release.mockRejectedValueOnce(new Error("session release failed"));

    await expect(harness.distube.shutdown()).rejects.toMatchObject({
      code: ErrorCode.VOICE_FAILED,
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
      throw new DisTubeError(ErrorCode.PLUGIN_FAILED, "nested failure", {
        cause: new AggregateError([new Error("nested leaf"), "string leaf"]),
      });
    });
    third.dispose.mockImplementation(() => {
      throw new DisTubeError(ErrorCode.PLUGIN_FAILED, "missing cause");
    });
    const distube = new DisTube({ adapter: new FakeAdapter(), plugins: [first, second, third] });

    const failure = (await capture(distube.shutdown())) as DisTubeError;

    expect(failure.code).toBe(ErrorCode.PLUGIN_FAILED);
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors.map(error => (error as Error).message)).toEqual(
      expect.arrayContaining(["raw failure", "nested leaf", "string leaf", "missing cause"]),
    );
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(third.dispose).toHaveBeenCalledTimes(1);
  });

  it("attempts every disposal and preserves each cause in one aggregate", async () => {
    const harness = playableSetup();
    const second = new FakeSource("second");
    harness.source.dispose.mockImplementation(() => {
      throw new Error("plugin dispose failed");
    });
    second.dispose.mockImplementation(() => {
      throw new Error("second dispose failed");
    });
    const distube = new DisTube({ adapter: harness.adapter, plugins: [harness.source, second] });
    await distube.play(TARGET, "a");
    await settle();
    harness.engine.players[0]?.stopTrack.mockRejectedValue(new Error("stop failed"));

    const failure = (await capture(distube.shutdown())) as DisTubeError;

    expect(failure).toBeInstanceOf(DisTubeError);
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors.map(error => (error as Error).message)).toEqual(
      expect.arrayContaining(["stop failed", "plugin dispose failed", "second dispose failed"]),
    );
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
    expect(failure.code).toBe(ErrorCode.QUEUE_FAILED);
    expect(failure.cause).toBe(reason);
    expect(queue.state.items).toEqual([]);
    await harness.distube.shutdown();
  });

  it("produces no cause when the abort reason is not an Error", async () => {
    const harness = playableSetup();
    const controller = new AbortController();
    controller.abort("just a string");

    const failure = (await capture(
      harness.distube.resolve("https://provider.example/a", { signal: controller.signal }),
    )) as DisTubeError;

    expect(failure.code).toBe(ErrorCode.QUEUE_FAILED);
    expect(failure.cause).toBeUndefined();
    await harness.distube.shutdown();
  });
});

describe("errors", () => {
  it("has exactly six public codes", () => {
    expect(Object.values(ErrorCode)).toEqual([
      "INVALID_ARGUMENT",
      "SOURCE_FAILED",
      "VOICE_FAILED",
      "PLUGIN_FAILED",
      "QUEUE_FAILED",
      "UNSUPPORTED",
    ]);
    expect(new DisTubeError(ErrorCode.QUEUE_FAILED, "failed")).toBeInstanceOf(Error);
  });
});
