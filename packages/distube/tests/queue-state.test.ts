import { describe, expect, it } from "vitest";
import { QueueItem, Song } from "../src";
import {
  appendItems,
  clearQueue,
  failFirst,
  finishCurrent,
  IDLE_QUEUE_STATE,
  removeItem,
  setStatus,
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
    const inserted = appendItems(IDLE_QUEUE_STATE, [a]);
    expect(inserted).toEqual({ items: [a], status: "idle" });
    expect(IDLE_QUEUE_STATE).toEqual({ items: [], status: "idle" });
  });

  it("removes a pending selected occurrence by stable ID", () => {
    const a = item();
    const b = item();
    const result = removeItem(appendItems(IDLE_QUEUE_STATE, [a, b]), a.id);
    expect(result).toMatchObject({ item: a, state: { items: [b], status: "idle" } });
  });

  it("commits start only from the earliest waiting item", () => {
    const a = item();
    const b = item();
    expect(startFirst(appendItems(IDLE_QUEUE_STATE, [a, b]))).toMatchObject({
      item: a,
      state: { current: a, items: [b], status: "playing" },
    });
  });

  it("clears current and waiting state terminally", () => {
    const a = item();
    const started = startFirst(appendItems(IDLE_QUEUE_STATE, [a]))?.state;
    expect(clearQueue(started ?? IDLE_QUEUE_STATE)).toBe(IDLE_QUEUE_STATE);
  });

  it("progresses skip and finish to idle while preserving waiting order", () => {
    const a = item();
    const b = item();
    const started = startFirst(appendItems(IDLE_QUEUE_STATE, [a, b]))?.state;
    const finished = finishCurrent(started ?? IDLE_QUEUE_STATE);
    expect(finished).toEqual({ items: [b], status: "idle" });
    expect(startFirst(finished)?.item).toBe(b);
  });

  it("drops failed waiting items deterministically and exhausts to idle", () => {
    const a = item();
    const b = item();
    const queued = appendItems(IDLE_QUEUE_STATE, [a, b]);
    expect(failFirst(failFirst(queued, a.id), b.id)).toEqual({ items: [], status: "idle" });
  });

  it("changes control status without mutating Song or QueueItem identity", () => {
    const a = item();
    const started = startFirst(appendItems(IDLE_QUEUE_STATE, [a]))?.state ?? IDLE_QUEUE_STATE;
    const paused = setStatus(started, "paused");
    expect(paused.current).toBe(a);
    expect(paused.current?.song).toBe(song);
    expect(Object.isFrozen(paused)).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(song)).toBe(true);
  });
});
