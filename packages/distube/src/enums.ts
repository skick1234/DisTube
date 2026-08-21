/**
 * Canonical public vocabulary.
 *
 * Every member is a string-valued enum member, so `Events.QueueItemStarted` and
 * `"queue.item.started"` are interchangeable at call sites keyed by literal strings,
 * and serialized values stay readable in logs and JSON.
 */

/** The complete public event surface. */
export enum Events {
  QueueCreated = "queue.created",
  QueueItemAdded = "queue.item.added",
  QueuePlaylistAdded = "queue.playlist.added",
  QueueItemStarted = "queue.item.started",
  QueueItemFinished = "queue.item.finished",
  QueueItemFailed = "queue.item.failed",
  QueueFinished = "queue.finished",
  QueueAutoplayFailed = "queue.autoplay.failed",
  QueueDeleted = "queue.deleted",
  VoiceDisconnected = "voice.disconnected",
}

/** How a naturally finished QueueItem is reconsidered before progression. */
export enum RepeatMode {
  Off = "off",
  Song = "song",
  Queue = "queue",
}

/** Committed playback status of a GuildQueue. */
export enum QueueStatus {
  Idle = "idle",
  Playing = "playing",
  Paused = "paused",
}

/**
 * Conventional filter names every engine ships a default definition for.
 *
 * Core treats these as plain names; each engine owns the rendered payload, so the
 * same application call renders natively on every backend.
 */
export enum Filters {
  ThreeD = "3d",
  Bassboost = "bassboost",
  Earwax = "earwax",
  Echo = "echo",
  Flanger = "flanger",
  Gate = "gate",
  Haas = "haas",
  Karaoke = "karaoke",
  Mcompand = "mcompand",
  Nightcore = "nightcore",
  Phaser = "phaser",
  Reverse = "reverse",
  Surround = "surround",
  Tremolo = "tremolo",
  Vaporwave = "vaporwave",
}
