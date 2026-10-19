/** Internal spelling tables for the public literal vocabulary. */

/** How a naturally finished QueueItem is reconsidered before progression. */
export const RepeatMode = {
  Off: "off",
  Song: "song",
  Queue: "queue",
} as const;
export type RepeatMode = (typeof RepeatMode)[keyof typeof RepeatMode];

/** Committed playback status of a DisTubeQueue. */
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
