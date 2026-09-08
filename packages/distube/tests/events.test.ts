import { describe, expect, it, vi } from "vitest";
import type { Diagnostic, DisTubeGuild } from "../src";
import { DisTubeEventEmitter } from "../src/events";

// The emitter never reads the payload, so a bare shape is enough to exercise delivery.
const created = Object.freeze({
  guildId: "guild",
  queue: {} as DisTubeGuild,
  timestamp: 1,
  state: Object.freeze({ current: undefined, upcoming: Object.freeze([]), status: "idle" as const }),
});

describe("event delivery", () => {
  it("returns an idempotent unsubscribe without exposing listener storage", async () => {
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
    const synchronous = new DisTubeEventEmitter(() => {
      throw new Error("observer failed");
    });
    expect(() => synchronous.report({ severity: "error", stage: "test", message: "diagnostic" })).not.toThrow();

    const asynchronous = new DisTubeEventEmitter(async () => {
      throw new Error("observer rejected");
    });
    asynchronous.report({ severity: "warning", stage: "test", message: "diagnostic" });
    await Promise.resolve();
  });
});
