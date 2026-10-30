import { DisTubeError } from "./errors";
import type { QueueItem } from "./media";

/** How a naturally finished QueueItem is reconsidered before progression. */
export type RepeatMode = "off" | "song" | "queue";

/**
 * Committed playback status of a DisTubeQueue. `preparing` holds while an item waits or an autoplay lookup runs, and
 * from the hand-off of the current item until it is audible; `playing` starts with `queue.item.started`.
 */
export type QueueStatus = "idle" | "preparing" | "playing" | "paused";

/**
 * The committed schedule of one DisTubeQueue: an immutable value replaced on every commit.
 *
 * `Metadata` is the client's caller-metadata type, threaded so a read of `item.metadata` needs no cast.
 */
export interface QueueState<Metadata = unknown> {
  readonly current: QueueItem<Metadata> | undefined;
  readonly upcoming: readonly QueueItem<Metadata>[];
  /** Recently ended occurrences, newest last, bounded by `DisTubeOptions.historySize`. */
  readonly history: readonly QueueItem<Metadata>[];
  readonly status: QueueStatus;
  readonly repeat: RepeatMode;
  readonly autoplay: boolean;
}

const NO_ITEMS: readonly QueueItem[] = Object.freeze([]);

export const IDLE_QUEUE_STATE: QueueState = Object.freeze({
  current: undefined,
  upcoming: NO_ITEMS,
  history: NO_ITEMS,
  status: "idle",
  repeat: "off",
  autoplay: false,
});

type Removal = Readonly<{ items: readonly QueueItem[]; state: QueueState }>;

function patch(current: QueueState, changes: Partial<QueueState>): QueueState {
  const next = { ...current, ...changes };
  return Object.freeze({
    ...next,
    upcoming: next.upcoming === current.upcoming ? current.upcoming : Object.freeze([...next.upcoming]),
    history: next.history === current.history ? current.history : Object.freeze([...next.history]),
  });
}

/** Inserts committed occurrences at `at` in the waiting list, appending when `at` is absent or past the end. */
export function insertAt(current: QueueState, items: readonly QueueItem[], at?: number): QueueState {
  if (items.length === 0) return current;
  const index = at === undefined ? current.upcoming.length : Math.min(Math.max(at, 0), current.upcoming.length);
  return patch(current, { upcoming: current.upcoming.toSpliced(index, 0, ...items) });
}

export function startFirst(current: QueueState): { readonly item: QueueItem; readonly state: QueueState } | undefined {
  const item = current.upcoming[0];
  if (!item || current.current) return undefined;
  return Object.freeze({
    item,
    state: patch(current, { upcoming: current.upcoming.slice(1), current: item, status: "preparing" }),
  });
}

export function markPlaying(current: QueueState): QueueState {
  return current.current && current.status !== "playing" ? patch(current, { status: "playing" }) : current;
}

export function settleStatus(current: QueueState, lookup: boolean): QueueState {
  if (current.current) return current;
  const status = current.upcoming.length > 0 || lookup ? "preparing" : "idle";
  return status === current.status ? current : patch(current, { status });
}

/** Drops a waiting occurrence that could not be prepared or started. */
export function failFirst(current: QueueState, itemId: string): QueueState {
  if (!current.upcoming.some(item => item.id === itemId)) return current;
  return patch(current, { upcoming: current.upcoming.filter(item => item.id !== itemId) });
}

export function finishCurrent(current: QueueState): QueueState {
  return patch(current, { current: undefined, status: "idle" });
}

/** Removes one upcoming occurrence by its stable ID. */
export function removeItem(current: QueueState, itemId: string): Removal {
  if (!itemId) throw new DisTubeError("INVALID_ARGUMENT", "Occurrence ID must be a non-empty string");
  const index = current.upcoming.findIndex(item => item.id === itemId);
  if (index < 0) throw new DisTubeError("INVALID_STATE", "Occurrence is not upcoming in this queue");
  return removeRange(current, index, index);
}

/** Removes the zero-based inclusive index range from the waiting list; both ends must be waiting. */
export function removeRange(current: QueueState, from: number, to: number): Removal {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from)
    throw new DisTubeError("INVALID_ARGUMENT", "Range positions must be a non-inverted pair of positive integers");
  if (to >= current.upcoming.length) throw new DisTubeError("INVALID_STATE", "Range is not upcoming in this queue");
  return Object.freeze({
    items: Object.freeze(current.upcoming.slice(from, to + 1)),
    state: patch(current, { upcoming: current.upcoming.toSpliced(from, to - from + 1) }),
  });
}

/** Moves a waiting occurrence before another one, or to the tail when `beforeItemId` is absent. */
export function moveBefore(current: QueueState, itemId: string, beforeItemId?: string): QueueState {
  if (
    typeof itemId !== "string" ||
    !itemId ||
    (beforeItemId !== undefined && (typeof beforeItemId !== "string" || !beforeItemId))
  ) {
    throw new DisTubeError("INVALID_ARGUMENT", "Occurrence IDs must be non-empty strings");
  }
  const item = current.upcoming.find(entry => entry.id === itemId);
  if (!item || (beforeItemId !== undefined && !current.upcoming.some(entry => entry.id === beforeItemId))) {
    throw new DisTubeError("INVALID_STATE", "Occurrence is not upcoming in this queue");
  }
  const following = current.upcoming[current.upcoming.indexOf(item) + 1];
  if (itemId === beforeItemId || following?.id === beforeItemId) return current;
  const rest = current.upcoming.filter(entry => entry !== item);
  const index = beforeItemId === undefined ? rest.length : rest.findIndex(entry => entry.id === beforeItemId);
  return patch(current, { upcoming: rest.toSpliced(index, 0, item) });
}

/**
 * Ends the current occurrence and brings the waiting occurrence at `index` to the front.
 *
 * The ended current item and the items before the target are returned as `skipped`, in their original
 * order; with `requeue` they are re-appended to the tail, otherwise the caller sends them to history.
 */
export function jumpTo(
  current: QueueState,
  index: number,
  requeue: boolean,
): Readonly<{ state: QueueState; skipped: readonly QueueItem[] }> {
  if (index < 0 || index >= current.upcoming.length)
    throw new DisTubeError("INVALID_STATE", "Jump target is not upcoming in this queue");
  const skipped = [...(current.current ? [current.current] : []), ...current.upcoming.slice(0, index)];
  if (skipped.length === 0) return Object.freeze({ state: current, skipped: NO_ITEMS });
  const upcoming = [...current.upcoming.slice(index), ...(requeue ? skipped : [])];
  return Object.freeze({
    state: patch(current, { current: undefined, status: "idle", upcoming }),
    skipped: Object.freeze(skipped),
  });
}

/** Fisher-Yates over the waiting list; the current item never moves. */
export function shuffle(current: QueueState, random: () => number = Math.random): QueueState {
  if (current.upcoming.length < 2) return current;
  const upcoming = [...current.upcoming];
  for (let index = upcoming.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [upcoming[index], upcoming[other]] = [upcoming[other] as QueueItem, upcoming[index] as QueueItem];
  }
  if (upcoming.every((item, index) => item === current.upcoming[index])) return current;
  return patch(current, { upcoming });
}

/** Empties the waiting list without touching the current item. */
export function clearUpcoming(current: QueueState): Removal {
  if (current.upcoming.length === 0) return Object.freeze({ items: NO_ITEMS, state: current });
  return Object.freeze({ items: current.upcoming, state: patch(current, { upcoming: NO_ITEMS }) });
}

/** Appends an ended occurrence, evicting the oldest past `size`. A size of 0 keeps history empty. */
export function pushHistory(current: QueueState, item: QueueItem, size: number): QueueState {
  if (size <= 0) return current;
  const history = [...current.history, item];
  return patch(current, { history: history.slice(Math.max(0, history.length - size)) });
}

export function popHistory(current: QueueState): { readonly item: QueueItem; readonly state: QueueState } | undefined {
  const item = current.history.at(-1);
  if (!item) return undefined;
  return Object.freeze({ item, state: patch(current, { history: current.history.slice(0, -1) }) });
}
