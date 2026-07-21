import { DisTubeError, ErrorCode } from "../errors";
import type { QueueItem } from "../media";

export type QueueStatus = "idle" | "playing" | "paused";

export interface QueueState {
  readonly items: readonly QueueItem[];
  readonly current?: QueueItem;
  readonly status: QueueStatus;
}

export const IDLE_QUEUE_STATE: QueueState = Object.freeze({ items: Object.freeze([]), status: "idle" });

function state(items: readonly QueueItem[], current: QueueItem | undefined, status: QueueStatus): QueueState {
  return Object.freeze({ items: Object.freeze([...items]), ...(current ? { current } : {}), status });
}

export function appendItems(current: QueueState, items: readonly QueueItem[]): QueueState {
  return items.length === 0 ? current : state([...current.items, ...items], current.current, current.status);
}

export function startFirst(current: QueueState): { readonly item: QueueItem; readonly state: QueueState } | undefined {
  const item = current.items[0];
  if (!item || current.current) return undefined;
  return Object.freeze({ item, state: state(current.items.slice(1), item, "playing") });
}

export function failFirst(current: QueueState, itemId: string): QueueState {
  return state(
    current.items.filter(item => item.id !== itemId),
    current.current,
    current.status,
  );
}

export function finishCurrent(current: QueueState): QueueState {
  return state(current.items, undefined, "idle");
}

export function removeItem(
  current: QueueState,
  itemId: string,
): { readonly item: QueueItem; readonly state: QueueState } {
  if (current.current?.id === itemId) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Cannot remove the current QueueItem");
  }
  const index = current.items.findIndex(item => item.id === itemId);
  if (index < 0) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Unknown QueueItem: ${itemId}`);
  const item = current.items[index] as QueueItem;
  return Object.freeze({ item, state: state(current.items.toSpliced(index, 1), current.current, current.status) });
}

export function setStatus(current: QueueState, status: QueueStatus): QueueState {
  return current.status === status ? current : state(current.items, current.current, status);
}

export function clearQueue(current: QueueState): QueueState {
  return current.current || current.items.length > 0 || current.status !== "idle" ? IDLE_QUEUE_STATE : current;
}
