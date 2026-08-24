import type { PlaybackRequest, PlayerEvent } from "../contracts";
import type { RepeatMode } from "../enums";
import type { QueueItem } from "../media";
import type { FilterChange } from "../voice/filters";

/** Identifies one item occurrence within a queue attempt. Voice adds its private lease generation. */
export interface QueueItemAuthority {
  readonly queueId: string;
  readonly attemptGeneration: number;
  readonly itemId: string;
}

/** Voice adds its private lease generation before sending an accepted outcome back to GuildQueue. */
export interface LeasedPlayerOutcome {
  readonly authority: QueueItemAuthority & Readonly<{ leaseGeneration: number }>;
  readonly event: PlayerEvent;
}

export interface QueueLeaseRequest {
  readonly queueId: string;
  readonly signal: AbortSignal;
  readonly onOutcome: (outcome: LeasedPlayerOutcome) => void;
}

export type QueuePlayerEffect =
  | Readonly<{ kind: "play"; authority: QueueItemAuthority; request: PlaybackRequest }>
  | Readonly<{ kind: "stop"; authority: QueueItemAuthority }>
  | Readonly<{ kind: "pause"; authority: QueueItemAuthority }>
  | Readonly<{ kind: "resume"; authority: QueueItemAuthority }>
  | Readonly<{ kind: "seek"; authority: QueueItemAuthority; seconds: number }>;

/**
 * A guild Voice available to a queue. It keeps Player and session ownership private.
 *
 * The durable playback settings are read and written here so a queue observes the Voice's committed
 * values synchronously inside its own decisions and never owns a copy.
 */
export interface QueueVoice {
  readonly guildId: string;
  readonly generation: number;
  readonly volume: number;
  readonly repeatMode: RepeatMode;
  readonly autoplay: boolean;
  /** Finished and skipped occurrences of this guild, oldest first. */
  readonly previousSongs: readonly QueueItem[];
  /** The newest played occurrence, or `undefined` when none exists yet. */
  lastPlayedSong(): QueueItem | undefined;
  /** Removes and returns the newest played occurrence for `previous()` replay. */
  popPreviousSong(): QueueItem | undefined;
  /** Appends finished and skipped occurrences to the bounded history. */
  rememberPlayed(items: readonly QueueItem[]): void;
  /** Renders a folded filter change on the Voice Player and commits it after the effect succeeds. */
  commitFilters(change: FilterChange): Promise<void>;
  /** Registers the queue's autoplay notification; one listener at a time, latest wins. */
  onAutoplayChanged(listener: (enabled: boolean) => void): void;
  /** Removes a previously registered autoplay notification. */
  detachAutoplayListener(listener: ((enabled: boolean) => void) | undefined): void;
  acquireQueue(request: QueueLeaseRequest): Promise<QueueVoiceLease>;
}

/** One exclusive queue lease over a Voice-owned long-lived Player. */
export interface QueueVoiceLease {
  readonly generation: number;
  position(authority: QueueItemAuthority): number;
  run(effect: QueuePlayerEffect): Promise<void>;
  close(): Promise<void>;
}
