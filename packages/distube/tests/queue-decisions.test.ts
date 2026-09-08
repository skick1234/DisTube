import { describe, expect, it } from "vitest";
import { DisTubeError } from "../src";
import { QueueStatus } from "../src/enums";
import { QueueItem } from "../src/media";
import { cancelPlaybackAttempt, createPlaybackAttempt, isCurrentPlaybackAttempt } from "../src/queue/attempt";
import { decideControl } from "../src/queue/control";
import { asError, cleanupFailure } from "../src/queue/failures";
import type { ActivePlayback } from "../src/queue/protocol";
import { IDLE_QUEUE_STATE, insertItems, setStatus, startFirst } from "../src/queue/state";
import { media } from "./support/harness";

function item(id: string): QueueItem {
  return new QueueItem({ song: media("source", id) });
}

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
    expect(cleanupFailure("QUEUE_FAILED", "failed", [], "failures")).toBeUndefined();
    expect(cleanupFailure("QUEUE_FAILED", "failed", [new Error("one")], "failures")).toMatchObject({
      code: "QUEUE_FAILED",
      cause: expect.objectContaining({ message: "one" }),
    });
    expect(cleanupFailure("QUEUE_FAILED", "failed", [new Error("one"), new Error("two")], "failures")).toMatchObject({
      cause: expect.any(AggregateError),
    });
    expect(asError("plain")).toMatchObject({ message: "Operation failed with a non-Error value" });
    expect(asError(new Error("exact"))).toMatchObject({ message: "exact" });
  });
});
