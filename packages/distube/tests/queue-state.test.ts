import { describe, expect, it } from "vitest";
import { QueueItem, QueueStatus, Song } from "../src";
import {
  clearItems,
  clearQueue,
  failFirst,
  finishCurrent,
  frontItems,
  IDLE_QUEUE_STATE,
  insertItems,
  jumpItems,
  removeItem,
  setStatus,
  shuffleItems,
  startFirst,
} from "../src/queue/state";

const song = new Song({
  id: "song",
  title: "Song",
  url: "https://provider.example/song",
  duration: 1,
  source: "source",
});
const item = () => new QueueItem({ song });

describe("pure QueueState playback transitions", () => {
  it("acknowledges insertion without selecting playback", () => {
    const a = item();
    const inserted = insertItems(IDLE_QUEUE_STATE, [a]);
    expect(inserted).toEqual({ items: [a], status: "idle" });
    expect(IDLE_QUEUE_STATE).toEqual({ items: [], status: "idle" });
  });

  it("inserts at a position and clamps beyond the end", () => {
    const [a, b, c] = [item(), item(), item()];
    const queued = insertItems(insertItems(IDLE_QUEUE_STATE, [a, b]), [c], 1);
    expect(queued.items).toEqual([a, c, b]);
    expect(insertItems(queued, [item()], 99).items).toHaveLength(4);
  });

  it("removes waiting occurrences by ID, index, and inclusive range", () => {
    const [a, b, c] = [item(), item(), item()];
    const queued = insertItems(IDLE_QUEUE_STATE, [a, b, c]);
    expect(removeItem(queued, a.id)).toMatchObject({ items: [a], state: { items: [b, c], status: "idle" } });
    expect(removeItem(queued, 1)).toMatchObject({ items: [b], state: { items: [a, c] } });
    expect(removeItem(queued, { from: 0, to: 1 })).toMatchObject({ items: [a, b], state: { items: [c] } });
  });

  it("moves a one-based jump target to the head, dropping or requeueing what it passed", () => {
    const [a, b, c] = [item(), item(), item()];
    const queued = insertItems(IDLE_QUEUE_STATE, [a, b, c]);
    expect(jumpItems(queued, 3, false)).toMatchObject({ passed: [a, b], state: { items: [c] } });
    expect(jumpItems(queued, c.id, true)).toMatchObject({ passed: [], state: { items: [c, a, b] } });
  });

  it("shuffles, clears, and fronts waiting items without touching the current one", () => {
    const [a, b] = [item(), item()];
    const playing = startFirst(insertItems(IDLE_QUEUE_STATE, [a, b]))?.state ?? IDLE_QUEUE_STATE;
    expect(shuffleItems(playing)).toMatchObject({ items: [b], current: a });
    expect(clearItems(playing)).toMatchObject({ items: [], current: a });
    const replay = item();
    expect(frontItems(playing, [replay]).items).toEqual([replay, b]);
  });

  it("commits start only from the earliest waiting item", () => {
    const a = item();
    const b = item();
    expect(startFirst(insertItems(IDLE_QUEUE_STATE, [a, b]))).toMatchObject({
      item: a,
      state: { current: a, items: [b], status: "playing" },
    });
  });

  it("clears current and waiting state terminally", () => {
    const a = item();
    const started = startFirst(insertItems(IDLE_QUEUE_STATE, [a]))?.state;
    expect(clearQueue(started ?? IDLE_QUEUE_STATE)).toBe(IDLE_QUEUE_STATE);
  });

  it("progresses skip and finish to idle while preserving waiting order", () => {
    const a = item();
    const b = item();
    const started = startFirst(insertItems(IDLE_QUEUE_STATE, [a, b]))?.state;
    const finished = finishCurrent(started ?? IDLE_QUEUE_STATE);
    expect(finished).toEqual({ items: [b], status: "idle" });
    expect(startFirst(finished)?.item).toBe(b);
  });

  it("drops failed waiting items deterministically and exhausts to idle", () => {
    const a = item();
    const b = item();
    const queued = insertItems(IDLE_QUEUE_STATE, [a, b]);
    expect(failFirst(failFirst(queued, a.id), b.id)).toEqual({ items: [], status: "idle" });
  });

  it("changes control status without mutating Song or QueueItem identity", () => {
    const a = item();
    const started = startFirst(insertItems(IDLE_QUEUE_STATE, [a]))?.state ?? IDLE_QUEUE_STATE;
    const paused = setStatus(started, QueueStatus.Paused);
    expect(paused.current).toBe(a);
    expect(paused.current?.song).toBe(song);
    expect(Object.isFrozen(paused)).toBe(true);
    expect(Object.isSealed(a)).toBe(true);
    expect(Object.isFrozen(song)).toBe(true);
  });

  it("preserves identity for no-op transitions and rejects invalid removals", () => {
    const a = item();
    expect(insertItems(IDLE_QUEUE_STATE, [])).toBe(IDLE_QUEUE_STATE);
    expect(clearQueue(IDLE_QUEUE_STATE)).toBe(IDLE_QUEUE_STATE);
    expect(setStatus(IDLE_QUEUE_STATE, QueueStatus.Idle)).toBe(IDLE_QUEUE_STATE);
    const started = startFirst(insertItems(IDLE_QUEUE_STATE, [a]))?.state ?? IDLE_QUEUE_STATE;
    expect(startFirst(started)).toBeUndefined();
    expect(clearItems(IDLE_QUEUE_STATE)).toBe(IDLE_QUEUE_STATE);
    expect(frontItems(IDLE_QUEUE_STATE, [])).toBe(IDLE_QUEUE_STATE);
    expect(() => removeItem(started, a.id)).toThrow("Cannot remove the current QueueItem");
    expect(() => removeItem(IDLE_QUEUE_STATE, "missing")).toThrow("Unknown QueueItem");
    const waiting = insertItems(started, [item(), item()]);
    expect(() => removeItem(waiting, { from: 1, to: 0 })).toThrow("Range `to` must not precede `from`");
    expect(() => removeItem(waiting, null as never)).toThrow("Removal target must be");
    expect(() => removeItem(waiting, 2)).toThrow("Waiting index is out of range");
    expect(() => jumpItems(waiting, "missing", false)).toThrow("Unknown QueueItem");
    expect(() => jumpItems(waiting, 0, false)).toThrow("Waiting position is out of range");
  });
});
