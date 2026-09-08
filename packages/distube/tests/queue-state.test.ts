import { describe, expect, it } from "vitest";
import { Song } from "../src";
import { QueueStatus } from "../src/enums";
import { QueueItem } from "../src/media";
import {
  clearQueue,
  failFirst,
  finishCurrent,
  frontItems,
  IDLE_QUEUE_STATE,
  insertItems,
  removeItem,
  setStatus,
  startFirst,
} from "../src/queue/state";

const song = new Song({
  id: "song",
  name: "Song",
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

  it("appends new occurrences in order without mutating the waiting list", () => {
    const [a, b, c] = [item(), item(), item()];
    const original = insertItems(IDLE_QUEUE_STATE, [a, b]);
    expect(insertItems(original, [c]).items).toEqual([a, b, c]);
    expect(original.items).toEqual([a, b]);
  });

  it("removes exactly one upcoming occurrence by ID and preserves the current item", () => {
    const [a, b, c] = [item(), item(), item()];
    const playing = startFirst(insertItems(IDLE_QUEUE_STATE, [a, b, c]))?.state ?? IDLE_QUEUE_STATE;
    expect(removeItem(playing, b.id)).toMatchObject({
      items: [b],
      state: { current: a, items: [c], status: "playing" },
    });
    expect(playing.items).toEqual([b, c]);
  });

  it("fronts a repeated occurrence without changing the current item", () => {
    const [a, b] = [item(), item()];
    const playing = startFirst(insertItems(IDLE_QUEUE_STATE, [a, b]))?.state ?? IDLE_QUEUE_STATE;
    const repeated = item();
    expect(frontItems(playing, [repeated])).toMatchObject({ current: a, items: [repeated, b] });
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
    expect(frontItems(IDLE_QUEUE_STATE, [])).toBe(IDLE_QUEUE_STATE);
    expect(() => removeItem(started, a.id)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => removeItem(IDLE_QUEUE_STATE, "missing")).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => removeItem(started, "")).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() => removeItem(started, null as never)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });
});
