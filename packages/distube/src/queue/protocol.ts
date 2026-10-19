import type { RepeatMode } from "../enums";
import type { Playlist, QueueItem, Song } from "../media";
import type { OwnedPlaybackResource } from "../playback/resource";
import type { TrackOutcome } from "../voice/DisTubeVoice";

/** Options for `DisTube.play` and `DisTubeQueue.add`. */
export interface AddOptions<Metadata = unknown> {
  /** Caller-owned reference stored on every QueueItem the call creates. */
  readonly metadata?: Metadata;
  /** Cancels the insertion; the call then rejects with `ABORTED` and adds nothing. */
  readonly signal?: AbortSignal;
  /** Zero-based position in `upcoming`, evaluated when the insertion commits. Past the end appends. */
  readonly at?: number;
  /** Equivalent to `at: 0`. Mutually exclusive with `at`. */
  readonly next?: boolean;
}

/** A waiting occurrence ID, a one-based position in `upcoming`, or an inclusive one-based range. */
export type RemoveTarget = string | number | Readonly<{ from: number; to: number }>;

export interface JumpOptions {
  /** Re-append the current item and the items before the target instead of sending them to history. */
  readonly requeue?: boolean;
}

export interface PlaybackAttempt {
  readonly item: QueueItem;
  readonly controller: AbortController;
  resource?: OwnedPlaybackResource;
  phase: "preparing" | "activating";
}

export interface ActivePlayback {
  readonly item: QueueItem;
}

/** A serialized edit of the waiting list. */
export type QueueEdit =
  | Readonly<{ kind: "remove"; target: RemoveTarget }>
  | Readonly<{ kind: "move"; itemId: string; beforeItemId?: string }>
  | Readonly<{ kind: "shuffle" }>
  | Readonly<{ kind: "clear" }>;

/** An operation that ends the current occurrence and starts another. */
export type AdvanceMode =
  | Readonly<{ kind: "skip" }>
  | Readonly<{ kind: "jump"; target: string | number; requeue: boolean }>
  | Readonly<{ kind: "previous" }>;

export type QueueSetting = Readonly<{ repeat: RepeatMode }> | Readonly<{ autoplay: boolean }>;

export type QueueMessage =
  | Readonly<{
      type: "insert";
      media: Song | Playlist;
      options: AddOptions;
      resolve: (items: readonly QueueItem[]) => void;
      reject: (error: unknown) => void;
    }>
  | Readonly<{ type: "start" }>
  | Readonly<{
      type: "preparation.completed";
      attempt: PlaybackAttempt;
      resource?: OwnedPlaybackResource;
      error?: unknown;
    }>
  | Readonly<{
      type: "play.completed";
      attempt: PlaybackAttempt;
      error?: unknown;
    }>
  /** The voice reported how the track this queue asked for ended. */
  | Readonly<{ type: "track.outcome"; outcome: TrackOutcome }>
  | Readonly<{
      type: "autoplay.completed";
      lookup: AbortController;
      seed: Song;
      song?: Song;
      error?: unknown;
    }>
  | Readonly<{
      type: "edit";
      edit: QueueEdit;
      resolve: (items: readonly QueueItem[]) => void;
      reject: (error: unknown) => void;
    }>
  | Readonly<{
      type: "setting";
      setting: QueueSetting;
      resolve: () => void;
      reject: (error: unknown) => void;
    }>
  | Readonly<{
      type: "control";
      control: "pause" | "resume" | "seek";
      seconds?: number;
      resolve: () => void;
      reject: (error: unknown) => void;
    }>
  | Readonly<{ type: "advance"; mode: AdvanceMode; resolve: () => void; reject: (error: unknown) => void }>;
