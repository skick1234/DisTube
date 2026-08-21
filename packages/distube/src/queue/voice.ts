import type { FilterEntry, PlaybackRequest, PlayerEvent } from "../contracts";

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
  | Readonly<{ kind: "seek"; authority: QueueItemAuthority; seconds: number }>
  | Readonly<{ kind: "volume"; percent: number }>
  | Readonly<{ kind: "filters"; entries: readonly FilterEntry[] }>;

/** A guild Voice available to a queue. It keeps Player and session ownership private. */
export interface QueueVoice {
  readonly guildId: string;
  readonly generation: number;
  acquireQueue(request: QueueLeaseRequest): Promise<QueueVoiceLease>;
}

/** One exclusive queue lease over a Voice-owned long-lived Player. */
export interface QueueVoiceLease {
  readonly generation: number;
  position(authority: QueueItemAuthority): number;
  run(effect: QueuePlayerEffect): Promise<void>;
  close(): Promise<void>;
}
