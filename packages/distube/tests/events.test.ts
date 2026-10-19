import { describe, expect, it, vi } from "vitest";
import type { Diagnostic, DisTubeQueue } from "../src";
import { DisTubeEventEmitter } from "../src/events";
import { FakeSource, setup } from "./support/harness";

// The emitter never reads the payload, so a bare shape is enough to exercise delivery.
const created = Object.freeze({
  guildId: "guild",
  queue: {} as DisTubeQueue,
  timestamp: 1,
  state: Object.freeze({
    current: undefined,
    upcoming: Object.freeze([]),
    history: Object.freeze([]),
    status: "idle" as const,
    repeat: "off" as const,
    autoplay: false,
  }),
});

describe("event delivery", () => {
  it("delivers after the commit and returns an idempotent unsubscribe", async () => {
    const emitter = new DisTubeEventEmitter(() => undefined);
    const listener = vi.fn();
    const unsubscribe = emitter.on("queue.created", listener);
    emitter.emit("queue.created", created);
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribe();
    emitter.emit("queue.created", created);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("removes only the registration belonging to each unsubscribe", async () => {
    const emitter = new DisTubeEventEmitter(() => undefined);
    const listener = vi.fn();
    const first = emitter.on("queue.created", listener);
    const second = emitter.on("queue.created", listener);
    first();
    emitter.emit("queue.created", created);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    second();
    emitter.emit("queue.created", created);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not add newly registered listeners to an in-progress delivery", async () => {
    const emitter = new DisTubeEventEmitter(() => undefined);
    const late = vi.fn();
    emitter.on("queue.created", () => emitter.on("queue.created", late));

    emitter.emit("queue.created", created);

    await Promise.resolve();
    expect(late).not.toHaveBeenCalled();
  });

  it("normalizes synchronous and asynchronous listener failures", async () => {
    const diagnostics: Diagnostic[] = [];
    const emitter = new DisTubeEventEmitter(diagnostic => diagnostics.push(diagnostic));
    emitter.on("queue.created", () => {
      throw "sync failure";
    });
    emitter.on("queue.created", async () => {
      throw new Error("async failure");
    });
    emitter.emit("queue.created", created);

    await vi.waitFor(() => expect(diagnostics).toHaveLength(2));
    expect(diagnostics.map(diagnostic => diagnostic.stage)).toEqual(["event.listener", "event.listener"]);
    expect(diagnostics.map(diagnostic => diagnostic.error?.message).sort()).toEqual([
      "Operation failed with a non-Error value",
      "async failure",
    ]);
    expect(diagnostics.every(Object.isFrozen)).toBe(true);
  });

  it("isolates diagnostic consumers that throw or reject", async () => {
    const throwing = vi.fn<(diagnostic: Diagnostic) => void>(() => {
      throw new Error("observer failed");
    });
    const synchronous = new DisTubeEventEmitter(throwing);
    expect(() => synchronous.report({ severity: "error", stage: "test", message: "diagnostic" })).not.toThrow();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(throwing).toHaveBeenCalledWith(expect.objectContaining({ stage: "test", message: "diagnostic" }));

    const rejecting = vi.fn<(diagnostic: Diagnostic) => Promise<void>>(async () => {
      throw new Error("observer rejected");
    });
    const asynchronous = new DisTubeEventEmitter(rejecting);
    asynchronous.report({ severity: "warning", stage: "test", message: "diagnostic" });
    await Promise.resolve();
    expect(rejecting).toHaveBeenCalledTimes(1);
    expect(rejecting).toHaveBeenCalledWith(expect.objectContaining({ stage: "test", message: "diagnostic" }));
  });

  it("sanitizes plugin diagnostics before the public consumer sees them", async () => {
    const source = new FakeSource("source");
    const raw = Object.assign(new Error("Authorization: Bearer private-token"), {
      headers: { token: "private-token" },
    });
    source.initialize.mockImplementation(context => {
      context.diagnostic({
        severity: "error",
        stage: "source.resolve",
        message: "Authorization: Bearer private-token",
        error: raw,
        detail: {
          operation: "resolve",
          status: 503,
          token: "private-token",
          native: { headers: { token: "private-token" } },
        },
      });
    });
    const harness = setup([source]);
    const diagnostic = harness.diagnostics.mock.calls[0]?.[0];

    expect(diagnostic).toMatchObject({
      stage: "source.resolve",
      message: "Authorization: [REDACTED]",
      detail: { operation: "resolve", status: 503 },
    });
    expect(diagnostic?.error).not.toBe(raw);
    expect(diagnostic?.error?.message).toBe("Authorization: [REDACTED]");
    expect(diagnostic?.detail).toEqual({ operation: "resolve", status: 503 });
    expect(Object.isFrozen(diagnostic?.detail)).toBe(true);
    await harness.distube.dispose();
  });
});
