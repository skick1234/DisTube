import type { FilterEntry, ResolvableInput } from "../contracts";
import type { RepeatMode } from "../enums";
import type { Playlist, QueueItem, Song } from "../media";
import type { OwnedPlaybackResource } from "../playback/prepare";
import type { FilterChange } from "./filters";
import type { JumpTarget, RemoveTarget } from "./state";
import type { LeasedPlayerOutcome, QueueItemAuthority, QueueVoiceLease } from "./voice";

export interface EnqueueOptions {
  /** Zero-based slot in the pending list; absent appends, beyond the end clamps. */
  readonly position?: number;
  /** Caller-owned reference stored on every QueueItem the call creates. */
  readonly metadata?: unknown;
}

export interface EnqueueOperation {
  readonly sequence: number;
  readonly controller: AbortController;
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

/** A serialized edit of the waiting list or of a queue-wide setting. */
export type QueueEdit =
  | Readonly<{ kind: "remove"; target: RemoveTarget }>
  | Readonly<{ kind: "shuffle" }>
  | Readonly<{ kind: "clear" }>
  | Readonly<{ kind: "repeat"; mode: RepeatMode }>
  | Readonly<{ kind: "autoplay"; enabled: boolean }>;

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
  | Readonly<{ type: "volume"; percent: number; resolve: () => void; reject: (error: unknown) => void }>
  | Readonly<{ type: "filters"; change: FilterChange; resolve: () => void; reject: (error: unknown) => void }>
  | Readonly<{
      type: "control";
      control: "pause" | "resume" | "seek";
      seconds?: number;
      resolve: () => void;
      reject: (error: unknown) => void;
    }>
  | Readonly<{ type: "advance"; mode: AdvanceMode; resolve: () => void; reject: (error: unknown) => void }>;

export type QueueControl = "pause" | "resume" | "seek";

export type LeaseEffectResult = Readonly<{ error?: unknown }>;

export type FilterEntries = readonly FilterEntry[];
