import { QueueStatus } from "../enums";
import { DisTubeError, ErrorCode } from "../errors";
import type { QueueItem } from "../media";

export interface QueueState {
  readonly items: readonly QueueItem[];
  readonly current?: QueueItem;
  readonly status: QueueStatus;
}

export const IDLE_QUEUE_STATE: QueueState = Object.freeze({
  items: Object.freeze([]),
  status: QueueStatus.Idle,
});

function state(items: readonly QueueItem[], current: QueueItem | undefined, status: QueueStatus): QueueState {
  return Object.freeze({ items: Object.freeze([...items]), ...(current ? { current } : {}), status });
}

/** Inserts into the pending list at `position`; an absent position appends, an out-of-range one clamps. */
export function insertItems(current: QueueState, items: readonly QueueItem[], position?: number): QueueState {
  if (items.length === 0) return current;
  const index = position === undefined ? current.items.length : Math.min(position, current.items.length);
  return state(current.items.toSpliced(index, 0, ...items), current.current, current.status);
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

/** One waiting occurrence by ID, by zero-based waiting index, or an inclusive zero-based index range. */
export type RemoveTarget = string | number | Readonly<{ from: number; to: number }>;

/** The next occurrence to play, by ID or by one-based waiting position (`1` is the next item). */
export type JumpTarget = string | number;

export function removeItem(
  current: QueueState,
  target: RemoveTarget,
): { readonly items: readonly QueueItem[]; readonly state: QueueState } {
  const [from, to] = removalRange(current, target);
  const items = Object.freeze(current.items.slice(from, to + 1));
  return Object.freeze({
    items,
    state: state(current.items.toSpliced(from, items.length), current.current, current.status),
  });
}

/** Randomly reorders the waiting items, leaving the current item untouched. */
export function shuffleItems(current: QueueState): QueueState {
  const items = [...current.items];
  for (let index = items.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [items[index], items[swap]] = [items[swap] as QueueItem, items[index] as QueueItem];
  }
  return state(items, current.current, current.status);
}

/** Drops every waiting item; the current item keeps playing. */
export function clearItems(current: QueueState): QueueState {
  return current.items.length === 0 ? current : state([], current.current, current.status);
}

/**
 * Moves the jump target to the head of the waiting items.
 *
 * Passed-over items either follow the remaining queue (`requeue`) or are reported as history.
 */
export function jumpItems(
  current: QueueState,
  target: JumpTarget,
  requeue: boolean,
): { readonly passed: readonly QueueItem[]; readonly state: QueueState } {
  const index = jumpIndex(current, target);
  const passed = Object.freeze(current.items.slice(0, index));
  const rest = current.items.slice(index + 1);
  const items = [current.items[index] as QueueItem, ...rest, ...(requeue ? passed : [])];
  return Object.freeze({
    passed: requeue ? Object.freeze([]) : passed,
    state: state(items, current.current, current.status),
  });
}

/** Puts `items` at the head of the waiting list, before everything already waiting. */
export function frontItems(current: QueueState, items: readonly QueueItem[]): QueueState {
  return items.length === 0 ? current : state([...items, ...current.items], current.current, current.status);
}

export function setStatus(current: QueueState, status: QueueStatus): QueueState {
  return current.status === status ? current : state(current.items, current.current, status);
}

/** Resolves a removal target to an inclusive `[from, to]` slice of the waiting items. */
function removalRange(current: QueueState, target: RemoveTarget): readonly [number, number] {
  if (typeof target === "string") {
    const index = current.items.findIndex(item => item.id === target);
    if (index < 0) {
      if (current.current?.id === target) {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Cannot remove the current QueueItem");
      }
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Unknown QueueItem: ${target}`);
    }
    return [index, index];
  }
  if (typeof target === "number") {
    const index = waitingIndex(current, target, "index");
    return [index, index];
  }
  if (!target || typeof target !== "object") {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Removal target must be a QueueItem ID, index, or range");
  }
  const from = waitingIndex(current, target.from, "from");
  const to = waitingIndex(current, target.to, "to");
  if (to < from) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Range `to` must not precede `from`");
  return [from, to];
}

function waitingIndex(current: QueueState, index: number, label: string): number {
  if (!Number.isInteger(index) || index < 0 || index >= current.items.length) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Waiting ${label} is out of range: ${index}`);
  }
  return index;
}

function jumpIndex(current: QueueState, target: JumpTarget): number {
  if (typeof target === "string") {
    const index = current.items.findIndex(item => item.id === target);
    if (index < 0) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Unknown QueueItem: ${target}`);
    return index;
  }
  // Positions are one-based so `jump(1)` names the next item rather than the one already playing.
  return waitingIndex(current, target - 1, "position");
}

export function clearQueue(current: QueueState): QueueState {
  return current.current || current.items.length > 0 || current.status !== QueueStatus.Idle
    ? IDLE_QUEUE_STATE
    : current;
}
