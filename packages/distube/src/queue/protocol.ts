import type { Player, PlayerEvent } from "../contracts";
import type { QueueItem, Song } from "../media";
import type { OwnedPlaybackResource } from "../playback/prepare";

export interface EnqueueOperation {
  readonly sequence: number;
  readonly controller: AbortController;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly resolve: (items: readonly QueueItem[]) => void;
  readonly reject: (error: unknown) => void;
}

export type EnqueueCompletion =
  | Readonly<{ operation: EnqueueOperation; songs: readonly Song[] }>
  | Readonly<{ operation: EnqueueOperation; error: unknown }>;

export interface PlaybackAttempt {
  readonly item: QueueItem;
  readonly controller: AbortController;
  player?: Player;
  resource?: OwnedPlaybackResource;
  phase: "connecting" | "preparing" | "activating";
}

export interface ActivePlayback {
  readonly item: QueueItem;
  readonly player: Player;
  readonly resource: OwnedPlaybackResource;
}

export type QueueMessage =
  | Readonly<{ type: "enqueue"; source: string | Song; operation: EnqueueOperation }>
  | Readonly<{ type: "enqueue.completed"; completion: EnqueueCompletion }>
  | Readonly<{ type: "start" }>
  | Readonly<{
      type: "player.ready";
      attempt: PlaybackAttempt;
      player?: Player;
      unsubscribe?: () => void;
      error?: unknown;
    }>
  | Readonly<{
      type: "preparation.completed";
      attempt: PlaybackAttempt;
      player: Player;
      resource?: OwnedPlaybackResource;
      error?: unknown;
    }>
  | Readonly<{
      type: "play.completed";
      attempt: PlaybackAttempt;
      player: Player;
      resource: OwnedPlaybackResource;
      error?: unknown;
    }>
  | Readonly<{ type: "player.outcome"; player: Player; event: PlayerEvent }>
  | Readonly<{ type: "remove"; itemId: string; resolve: (item: QueueItem) => void; reject: (error: unknown) => void }>
  | Readonly<{
      type: "control";
      control: "pause" | "resume" | "seek";
      seconds?: number;
      resolve: () => void;
      reject: (error: unknown) => void;
    }>
  | Readonly<{
      type: "control.completed";
      control: "pause" | "resume" | "seek";
      itemId: string;
      player: Player;
      resolve: () => void;
      reject: (error: unknown) => void;
      error?: unknown;
    }>
  | Readonly<{ type: "skip"; resolve: () => void; reject: (error: unknown) => void }>
  | Readonly<{
      type: "skip.completed";
      itemId: string;
      player: Player;
      active: ActivePlayback;
      resolve: () => void;
      reject: (error: unknown) => void;
      error?: unknown;
    }>
  | Readonly<{ type: "stop"; resolve: () => void; reject: (error: unknown) => void }>
  | Readonly<{ type: "destroy"; resolve: () => void; reject: (error: unknown) => void }>;
