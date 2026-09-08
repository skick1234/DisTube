/** Internal spelling tables for the public literal vocabulary. */

/** The complete public event surface. */
export const Events = {
  QueueCreated: "queue.created",
  QueueItemAdded: "queue.item.added",
  QueuePlaylistAdded: "queue.playlist.added",
  QueueItemStarted: "queue.item.started",
  QueueItemFinished: "queue.item.finished",
  QueueItemFailed: "queue.item.failed",
  QueueFinished: "queue.finished",
  QueueAutoplayFailed: "queue.autoplay.failed",
  QueueDeleted: "queue.deleted",
  VoiceDisconnected: "voice.disconnected",
} as const;
export type Events = (typeof Events)[keyof typeof Events];

export const ErrorReason = {
  Argument: "argument",
  State: "state",
} as const;
export type ErrorReason = (typeof ErrorReason)[keyof typeof ErrorReason];

/** How a naturally finished QueueItem is reconsidered before progression. */
export const RepeatMode = {
  Off: "off",
  Song: "song",
  Queue: "queue",
} as const;
export type RepeatMode = (typeof RepeatMode)[keyof typeof RepeatMode];

/** Committed playback status of a DisTubeGuild. */
export const QueueStatus = {
  Idle: "idle",
  Playing: "playing",
  Paused: "paused",
} as const;
export type QueueStatus = (typeof QueueStatus)[keyof typeof QueueStatus];

/**
 * Conventional filter names every engine ships a default definition for.
 *
 * Core treats these as plain names; each engine owns the rendered payload, so the
 * same application call renders natively on every backend.
 */
export const Filters = {
  ThreeD: "3d",
  Bassboost: "bassboost",
  Earwax: "earwax",
  Echo: "echo",
  Flanger: "flanger",
  Gate: "gate",
  Haas: "haas",
  Karaoke: "karaoke",
  Mcompand: "mcompand",
  Nightcore: "nightcore",
  Phaser: "phaser",
  Reverse: "reverse",
  Surround: "surround",
  Tremolo: "tremolo",
  Vaporwave: "vaporwave",
} as const;
export type Filters = (typeof Filters)[keyof typeof Filters];
