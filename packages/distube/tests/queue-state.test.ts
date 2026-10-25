import { describe, expect, it } from "vitest";
import { Song } from "../src";
import { type QueueItem, queueItem } from "../src/media";
import {
  clearUpcoming,
  failFirst,
  finishCurrent,
  IDLE_QUEUE_STATE,
  insertAt,
  jumpTo,
  moveBefore,
  popHistory,
  pushHistory,
  type QueueState,
  removeItem,
  removeRange,
  shuffle,
  startFirst,
} from "../src/queue-state";

const song = new Song({
  id: "song",
  name: "Song",
  url: "https://provider.example/song",
  duration: 1,
  source: "source",
});
const item = (): QueueItem => queueItem(song);
const ids = (items: readonly QueueItem[]): string[] => items.map(entry => entry.id);

/** A playing state: the first item is current, the rest wait. */
function playing(items: readonly QueueItem[]): QueueState {
  return startFirst(insertAt(IDLE_QUEUE_STATE, items))?.state ?? IDLE_QUEUE_STATE;
}

describe("insertion and start", () => {
  it("appends, inserts at a position, clamps past the end and treats next as position 0", () => {
    const [a, b, c, d] = [item(), item(), item(), item()];
    const appended = insertAt(IDLE_QUEUE_STATE, [a, b]);
    expect(appended).toMatchObject({ current: undefined, history: [], status: "idle" });
    expect(ids(appended.upcoming)).toEqual(ids([a, b]));
    expect(ids(insertAt(appended, [c], 1).upcoming)).toEqual(ids([a, c, b]));
    expect(ids(insertAt(appended, [c, d], 10).upcoming)).toEqual(ids([a, b, c, d]));
    expect(ids(insertAt(appended, [c], 0).upcoming)).toEqual(ids([c, a, b]));
    expect(ids(appended.upcoming)).toEqual(ids([a, b]));
    expect(insertAt(appended, [])).toBe(appended);
  });

  it("commits start only from the earliest waiting item and never over a current one", () => {
    const [a, b] = [item(), item()];
    const started = startFirst(insertAt(IDLE_QUEUE_STATE, [a, b]));
    expect(started?.item).toBe(a);
    expect(started?.state.current).toBe(a);
    expect(ids(started?.state.upcoming ?? [])).toEqual(ids([b]));
    expect(started?.state.status).toBe("playing");
    expect(startFirst(started?.state ?? IDLE_QUEUE_STATE)).toBeUndefined();
    expect(startFirst(IDLE_QUEUE_STATE)).toBeUndefined();
  });

  it("drops a failed waiting item and finishes the current one to idle", () => {
    const [a, b] = [item(), item()];
    expect(ids(failFirst(insertAt(IDLE_QUEUE_STATE, [a, b]), a.id).upcoming)).toEqual(ids([b]));
    const finished = finishCurrent(playing([a, b]));
    expect(finished).toMatchObject({ current: undefined, status: "idle" });
    expect(ids(finished.upcoming)).toEqual(ids([b]));
    expect(startFirst(finished)?.item).toBe(b);
  });
});

describe("edits", () => {
  it("removes one occurrence by ID and preserves the current item", () => {
    const [a, b, c] = [item(), item(), item()];
    const state = playing([a, b, c]);
    const removed = removeItem(state, b.id);
    expect(ids(removed.items)).toEqual(ids([b]));
    expect(removed.state.current).toBe(a);
    expect(ids(removed.state.upcoming)).toEqual(ids([c]));
    expect(ids(state.upcoming)).toEqual(ids([b, c]));
    expect(() => removeItem(state, a.id)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
  });

  it("removes an inclusive index range and rejects inverted or non-waiting ranges", () => {
    const [a, b, c, d, e] = [item(), item(), item(), item(), item()];
    const state = playing([a, b, c, d, e]);
    const removed = removeRange(state, 1, 2);
    expect(ids(removed.items)).toEqual(ids([c, d]));
    expect(removed.state.current).toBe(a);
    expect(ids(removed.state.upcoming)).toEqual(ids([b, e]));
    expect(() => removeRange(state, 2, 1)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() => removeRange(state, -1, 0)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() => removeRange(state, 1.5, 2)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() => removeRange(state, 3, 4)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
  });

  it("moves a waiting occurrence before another or to the tail", () => {
    const [a, b, c, d] = [item(), item(), item(), item()];
    const state = playing([a, b, c, d]);
    expect(ids(moveBefore(state, d.id, b.id).upcoming)).toEqual(ids([d, b, c]));
    expect(ids(moveBefore(state, b.id).upcoming)).toEqual(ids([c, d, b]));
    expect(moveBefore(state, b.id, b.id)).toBe(state);
    expect(() => moveBefore(state, a.id, b.id)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => moveBefore(state, b.id, "missing")).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => moveBefore(state, "", b.id)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });

  it("jumps to a waiting occurrence, requeueing or surrendering the skipped ones", () => {
    const [a, b, c, d] = [item(), item(), item(), item()];
    const state = playing([a, b, c, d]);
    const requeued = jumpTo(state, 1, true);
    expect(requeued.state).toMatchObject({ current: undefined, status: "idle" });
    expect(ids(requeued.state.upcoming)).toEqual(ids([c, d, a, b]));
    expect(ids(requeued.skipped)).toEqual(ids([a, b]));
    const dropped = jumpTo(state, 1, false);
    expect(ids(dropped.state.upcoming)).toEqual(ids([c, d]));
    expect(ids(dropped.skipped)).toEqual(ids([a, b]));
    expect(jumpTo(finishCurrent(state), 0, false).skipped).toEqual([]);
    expect(() => jumpTo(state, 3, false)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => jumpTo(state, -1, false)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
  });

  it("shuffles only the waiting list with the supplied randomness and is identity below two items", () => {
    const [a, b, c, d] = [item(), item(), item(), item()];
    const state = playing([a, b, c, d]);
    // A random source that always picks index 0 rotates the tail deterministically.
    const shuffled = shuffle(state, () => 0);
    expect(shuffled.current).toBe(a);
    expect(ids(shuffled.upcoming)).toEqual(ids([c, d, b]));
    expect(ids(state.upcoming)).toEqual(ids([b, c, d]));
    const single = playing([a, b]);
    expect(shuffle(single)).toBe(single);
    expect(shuffle(IDLE_QUEUE_STATE)).toBe(IDLE_QUEUE_STATE);
  });

  it("clears the waiting list and returns it, keeping the current item", () => {
    const [a, b, c] = [item(), item(), item()];
    const cleared = clearUpcoming(playing([a, b, c]));
    expect(ids(cleared.items)).toEqual(ids([b, c]));
    expect(cleared.state.current).toBe(a);
    expect(cleared.state).toMatchObject({ upcoming: [], status: "playing" });
  });
});

describe("history and settings", () => {
  it("bounds history to the ceiling, newest last, and keeps nothing at zero", () => {
    const [a, b, c, d] = [item(), item(), item(), item()];
    let state = IDLE_QUEUE_STATE;
    for (const entry of [a, b, c, d]) state = pushHistory(state, entry, 3);
    expect(ids(state.history)).toEqual(ids([b, c, d]));
    expect(pushHistory(IDLE_QUEUE_STATE, a, 0)).toBe(IDLE_QUEUE_STATE);
    expect(Object.isFrozen(state.history)).toBe(true);
  });

  it("pops the newest history entry", () => {
    const [a, b] = [item(), item()];
    const state = pushHistory(pushHistory(IDLE_QUEUE_STATE, a, 5), b, 5);
    const popped = popHistory(state);
    expect(popped?.item).toBe(b);
    expect(ids(popped?.state.history ?? [])).toEqual(ids([a]));
    expect(popHistory(IDLE_QUEUE_STATE)).toBeUndefined();
  });
});
