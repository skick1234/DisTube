import { describe, expect, it, vi } from "vitest";
import { DisTubeError, ErrorCode, QueueItem, QueueStatus } from "../src";
import { cancelPlaybackAttempt, createPlaybackAttempt, isCurrentPlaybackAttempt } from "../src/queue/attempt";
import { decideControl } from "../src/queue/control";
import { EnqueueCoordinator } from "../src/queue/enqueue";
import { asError, cleanupFailure } from "../src/queue/failures";
import type { ActivePlayback } from "../src/queue/protocol";
import { IDLE_QUEUE_STATE, insertItems, setStatus, startFirst } from "../src/queue/state";
import { media } from "./support/harness";

function item(id: string): QueueItem {
  return new QueueItem({ song: media("source", id) });
}

describe("enqueue coordination", () => {
  it("releases completed resolutions only in acceptance order", () => {
    const enqueues = new EnqueueCoordinator();
    const first = enqueues.create({}, vi.fn(), vi.fn());
    const second = enqueues.create({}, vi.fn(), vi.fn());
    enqueues.accept(first);
    enqueues.accept(second);
    const firstCompletion = { operation: first, media: item("first").song } as const;
    const secondCompletion = { operation: second, media: item("second").song } as const;

    expect(enqueues.complete(secondCompletion)).toEqual([]);
    expect(enqueues.complete(firstCompletion)).toEqual([firstCompletion, secondCompletion]);
  });

  it("cancels accepted work and ignores its late completion", () => {
    const enqueues = new EnqueueCoordinator();
    const reject = vi.fn();
    const operation = enqueues.create({}, vi.fn(), reject);
    enqueues.accept(operation);
    enqueues.cancel(() => new Error("stale"));

    expect(operation.controller.signal.aborted).toBe(true);
    expect(reject).toHaveBeenCalledWith(expect.objectContaining({ message: "stale" }));
    expect(enqueues.complete({ operation, media: item("late").song })).toEqual([]);
  });
});

describe("playback attempt decisions", () => {
  it("creates, identifies, and cancels attempts without owning a backend handle", () => {
    const candidate = createPlaybackAttempt(item("candidate"), 4, "queue");

    expect(candidate).toMatchObject({
      generation: 4,
      phase: "acquiring",
      authority: { queueId: "queue", attemptGeneration: 4, itemId: candidate.item.id },
    });
    expect(isCurrentPlaybackAttempt(candidate, candidate, false)).toBe(true);
    expect(isCurrentPlaybackAttempt(candidate, candidate, true)).toBe(false);
    expect(cancelPlaybackAttempt(candidate, new Error("cancelled"))).toBe(candidate);
    expect(candidate.controller.signal.aborted).toBe(true);
    expect(cancelPlaybackAttempt(undefined, new Error("unused"))).toBeUndefined();
  });
});

describe("control and failure decisions", () => {
  const current = item("current");
  const selected = startFirst(insertItems(IDLE_QUEUE_STATE, [current]));
  if (!selected) throw new Error("test queue item was not selected");
  const active: ActivePlayback = {
    item: current,
    authority: { queueId: "queue", attemptGeneration: 1, itemId: current.id },
    resource: {
      resource: { kind: "url", url: "https://stream.example/current", dispose: () => undefined },
      dispose: () => Promise.resolve(),
    },
  };

  it("distinguishes no-op, invocation, and invalid controls", () => {
    expect(decideControl(selected.state, active, "pause")).toEqual({ kind: "invoke", control: "pause" });
    expect(decideControl(selected.state, active, "resume")).toEqual({ kind: "noop" });
    expect(decideControl(setStatus(selected.state, QueueStatus.Paused), active, "pause")).toEqual({ kind: "noop" });
    expect(decideControl(selected.state, active, "seek", 12)).toEqual({
      kind: "invoke",
      control: "seek",
      seconds: 12,
    });
    expect(() => decideControl(selected.state, active, "seek", -1)).toThrow(DisTubeError);
    expect(() => decideControl(selected.state, undefined, "pause")).toThrow(DisTubeError);
  });

  it("normalizes zero, one, and aggregate cleanup failures", () => {
    expect(cleanupFailure(ErrorCode.QUEUE_FAILED, "failed", [], "failures")).toBeUndefined();
    expect(cleanupFailure(ErrorCode.QUEUE_FAILED, "failed", [new Error("one")], "failures")).toMatchObject({
      code: ErrorCode.QUEUE_FAILED,
      cause: expect.objectContaining({ message: "one" }),
    });
    expect(
      cleanupFailure(ErrorCode.QUEUE_FAILED, "failed", [new Error("one"), new Error("two")], "failures"),
    ).toMatchObject({ cause: expect.any(AggregateError) });
    expect(asError("plain")).toMatchObject({ message: "plain" });
    expect(asError(new Error("exact"))).toMatchObject({ message: "exact" });
  });
});
