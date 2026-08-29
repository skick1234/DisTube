import type { ResolvableInput } from "../contracts";
import type { Playlist, QueueItem, Song } from "../media";
import type { OwnedPlaybackResource } from "../playback/prepare";
import type { JumpTarget, RemoveTarget } from "./state";
import type { LeasedPlayerOutcome, QueueItemAuthority, QueueVoiceLease } from "./voice";

export interface EnqueueOptions<Metadata = unknown> {
  /** Zero-based slot in the pending list; absent appends, beyond the end clamps. */
  readonly position?: number;
  /** Caller-owned reference stored on every QueueItem the call creates. */
  readonly metadata?: Metadata;
  /** Cancels the insertion; the call then rejects with `QUEUE_FAILED` and adds nothing. */
  readonly signal?: AbortSignal;
}

export interface EnqueueOperation {
  readonly sequence: number;
  readonly controller: AbortController;
  /** The controller's signal, joined with the caller's when one was supplied. */
  readonly signal: AbortSignal;
  readonly options: EnqueueOptions;
  readonly resolve: (items: readonly QueueItem[]) => void;
  readonly reject: (error: unknown) => void;
}

export type EnqueueCompletion =
  | Readonly<{ operation: EnqueueOperation; media: Song | Playlist }>
  | Readonly<{ operation: EnqueueOperation; error: unknown }>;

export interface PlaybackAttempt {
  readonly generation: number;
  readonly item: QueueItem;
  readonly authority: QueueItemAuthority;
  readonly controller: AbortController;
  resource?: OwnedPlaybackResource;
  phase: "acquiring" | "preparing" | "activating";
}

export interface ActivePlayback {
  readonly item: QueueItem;
  readonly authority: QueueItemAuthority;
  readonly resource: OwnedPlaybackResource;
}

/** A serialized edit of the waiting list. */
export type QueueEdit =
  | Readonly<{ kind: "remove"; target: RemoveTarget }>
  | Readonly<{ kind: "shuffle" }>
  | Readonly<{ kind: "clear" }>;

/** How the current occurrence ends and where the queue continues afterwards. */
export type AdvanceMode =
  | Readonly<{ kind: "skip" }>
  | Readonly<{ kind: "jump"; target: JumpTarget; requeue: boolean }>
  | Readonly<{ kind: "previous" }>;

export type QueueMessage =
  | Readonly<{ type: "enqueue"; source: ResolvableInput; operation: EnqueueOperation }>
  | Readonly<{ type: "enqueue.completed"; completion: EnqueueCompletion }>
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "lease.ready"; attempt: PlaybackAttempt; lease?: QueueVoiceLease; error?: unknown }>
  | Readonly<{
      type: "preparation.completed";
      attempt: PlaybackAttempt;
      resource?: OwnedPlaybackResource;
      error?: unknown;
    }>
  | Readonly<{
      type: "play.completed";
      attempt: PlaybackAttempt;
      resource: OwnedPlaybackResource;
      error?: unknown;
    }>
  | Readonly<{ type: "lease.outcome"; outcome: LeasedPlayerOutcome }>
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
  /** The Voice committed a `setAutoplay` outside the queue's own decisions. */
  | Readonly<{ type: "autoplay.changed"; enabled: boolean }>
  | Readonly<{
      type: "control";
      control: "pause" | "resume" | "seek";
      seconds?: number;
      resolve: () => void;
      reject: (error: unknown) => void;
    }>
  | Readonly<{ type: "advance"; mode: AdvanceMode; resolve: () => void; reject: (error: unknown) => void }>;
