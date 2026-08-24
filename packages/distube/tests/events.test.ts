import { describe, expect, it, vi } from "vitest";
import type { Diagnostic, GuildQueue } from "../src";
import { DisTubeEventEmitter } from "../src/events";

// The emitter never reads the payload, so a bare shape is enough to exercise delivery.
const created = Object.freeze({ guildId: "guild", queue: {} as GuildQueue, timestamp: 1 });

describe("event delivery", () => {
  it("supports on, once, and off without exposing listener storage", () => {
    const emitter = new DisTubeEventEmitter(() => undefined);
    const persistent = vi.fn();
    const once = vi.fn();
    emitter.on("queue.created", persistent).once("queue.created", once);
    emitter.emit("queue.created", created);
    emitter.emit("queue.created", created);
    emitter.off("queue.created", persistent);
    emitter.emit("queue.created", created);

    expect(persistent).toHaveBeenCalledTimes(2);
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("removes a once listener when off is given the caller's own function", () => {
    const emitter = new DisTubeEventEmitter(() => undefined);
    const listener = vi.fn();
    // `once` registers a self-removing wrapper, so `off` has to match on the original, not the wrapper.
    emitter.once("queue.created", listener);
    emitter.off("queue.created", listener);
    emitter.emit("queue.created", created);

    expect(listener).not.toHaveBeenCalled();
  });

  it("removes one registration per off call, leaving the other in place", () => {
    const emitter = new DisTubeEventEmitter(() => undefined);
    const listener = vi.fn();
    emitter.once("queue.created", listener).on("queue.created", listener);

    emitter.off("queue.created", listener);
    emitter.emit("queue.created", created);
    emitter.emit("queue.created", created);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("drops one event's listeners, then every event's", () => {
    const emitter = new DisTubeEventEmitter(() => undefined);
    const onCreated = vi.fn();
    const onDeleted = vi.fn();
    emitter.on("queue.created", onCreated).on("queue.deleted", onDeleted);

    emitter.removeAllListeners("queue.created");
    emitter.emit("queue.created", created);
    emitter.emit("queue.deleted", created);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalledTimes(1);

    emitter.removeAllListeners();
    emitter.emit("queue.deleted", created);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("delivers an event to the listeners registered when it was emitted", () => {
    const emitter = new DisTubeEventEmitter(() => undefined);
    const late = vi.fn();
    emitter.on("queue.created", () => emitter.on("queue.created", late));

    emitter.emit("queue.created", created);

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
    expect(diagnostics.map(diagnostic => diagnostic.error?.message).sort()).toEqual(["async failure", "sync failure"]);
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
