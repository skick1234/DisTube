import { QueueStatus } from "../enums";
import { DisTubeError } from "../errors";
import type { QueueItem } from "../media";

export interface QueueState<Metadata = unknown> {
  readonly items: readonly QueueItem<Metadata>[];
  readonly current?: QueueItem<Metadata>;
  readonly status: QueueStatus;
}

export const IDLE_QUEUE_STATE: QueueState = Object.freeze({
  items: Object.freeze([]),
  status: QueueStatus.Idle,
});

function state(items: readonly QueueItem[], current: QueueItem | undefined, status: QueueStatus): QueueState {
  return Object.freeze({ items: Object.freeze([...items]), ...(current ? { current } : {}), status });
}

/** Appends committed occurrences to the upcoming list. */
export function insertItems(current: QueueState, items: readonly QueueItem[]): QueueState {
  if (items.length === 0) return current;
  return state([...current.items, ...items], current.current, current.status);
}

export function startFirst(current: QueueState): { readonly item: QueueItem; readonly state: QueueState } | undefined {
  const item = current.items[0];
  if (!item || current.current) return undefined;
  return Object.freeze({ item, state: state(current.items.slice(1), item, QueueStatus.Playing) });
}

export function failFirst(current: QueueState, itemId: string): QueueState {
  return state(
    current.items.filter(item => item.id !== itemId),
    current.current,
    current.status,
  );
}

export function finishCurrent(current: QueueState): QueueState {
  return state(current.items, undefined, QueueStatus.Idle);
}

/** Removes one upcoming occurrence by its stable ID. */
export function removeItem(
  current: QueueState,
  itemId: string,
): { readonly items: readonly QueueItem[]; readonly state: QueueState } {
  if (typeof itemId !== "string" || itemId.length === 0)
    throw new DisTubeError("INVALID_ARGUMENT", "Occurrence ID must be non-empty");
  const index = current.items.findIndex(item => item.id === itemId);
  if (index < 0) throw new DisTubeError("INVALID_STATE", "Occurrence is not upcoming in this queue");
  return Object.freeze({
    items: Object.freeze([current.items[index] as QueueItem]),
    state: state(current.items.toSpliced(index, 1), current.current, current.status),
  });
}

/** Puts `items` at the head of the waiting list, before everything already waiting. */
export function frontItems(current: QueueState, items: readonly QueueItem[]): QueueState {
  return items.length === 0 ? current : state([...items, ...current.items], current.current, current.status);
}

export function setStatus(current: QueueState, status: QueueStatus): QueueState {
  return current.status === status ? current : state(current.items, current.current, status);
}

export function clearQueue(current: QueueState): QueueState {
  return current.current || current.items.length > 0 || current.status !== QueueStatus.Idle
    ? IDLE_QUEUE_STATE
    : current;
}
