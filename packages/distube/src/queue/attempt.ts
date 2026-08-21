import type { QueueItem } from "../media";
import type { PlaybackAttempt } from "./protocol";

export function createPlaybackAttempt(item: QueueItem, generation: number, queueId: string): PlaybackAttempt {
  return {
    generation,
    item,
    authority: Object.freeze({ queueId, attemptGeneration: generation, itemId: item.id }),
    controller: new AbortController(),
    phase: "acquiring",
  };
}

export function isCurrentPlaybackAttempt(
  current: PlaybackAttempt | undefined,
  candidate: PlaybackAttempt,
  destroyRequested: boolean,
): boolean {
  return current === candidate && !destroyRequested;
}

export function cancelPlaybackAttempt(
  attempt: PlaybackAttempt | undefined,
  reason: Error,
): PlaybackAttempt | undefined {
  attempt?.controller.abort(reason);
  return attempt;
}
