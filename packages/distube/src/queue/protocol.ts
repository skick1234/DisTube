import type { Playlist, QueueItem, Song } from "../media";
import type { OwnedPlaybackResource } from "../playback/prepare";
import type { LeasedPlayerOutcome, QueueItemAuthority, QueueVoiceLease } from "./voice";

export interface EnqueueOptions<Metadata = unknown> {
  /** Caller-owned reference stored on every QueueItem the call creates. */
  readonly metadata?: Metadata;
  /** Cancels the insertion; the call then rejects with `ABORTED` and adds nothing. */
  readonly signal?: AbortSignal;
}

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
  | Readonly<{ kind: "remove"; target: string }>
  | Readonly<{ kind: "move"; itemId: string; beforeItemId?: string }>;

export type AdvanceMode = Readonly<{ kind: "skip" }>;

export type QueueMessage =
  | Readonly<{
      type: "insert";
      media: Song | Playlist;
      options: EnqueueOptions;
      resolve: (items: readonly QueueItem[]) => void;
      reject: (error: unknown) => void;
    }>
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
  /** The DisTubeVoice committed a `setAutoplay` outside the queue's own decisions. */
  | Readonly<{ type: "autoplay.changed"; enabled: boolean }>
  | Readonly<{
      type: "control";
      control: "pause" | "resume" | "seek";
      seconds?: number;
      resolve: () => void;
      reject: (error: unknown) => void;
    }>
  | Readonly<{ type: "advance"; mode: AdvanceMode; resolve: () => void; reject: (error: unknown) => void }>;
