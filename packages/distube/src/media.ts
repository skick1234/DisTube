import { randomUUID } from "node:crypto";
import { DisTubeError } from "./errors";

export interface SongData {
  readonly source: string;
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly duration?: number;
  readonly thumbnail?: string;
  readonly artist?: string;
}

/** Immutable provider-neutral identity and display fields. */
export class Song {
  readonly source: string;
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly duration?: number;
  readonly thumbnail?: string;
  readonly artist?: string;

  constructor(data: SongData) {
    if (!data) throw new DisTubeError("INVALID_ARGUMENT", "Song data must be an object");
    this.source = requireNonEmpty(data.source, "Song source");
    this.id = requireNonEmpty(data.id, "Song id");
    this.name = requireNonEmpty(data.name, "Song name");
    this.url = requireNonEmpty(data.url, "Song url");
    if (data.duration !== undefined) {
      if (!Number.isFinite(data.duration) || data.duration < 0) {
        throw new DisTubeError("INVALID_ARGUMENT", "Song duration must be a non-negative number");
      }
      this.duration = data.duration;
    }
    if (data.thumbnail !== undefined) this.thumbnail = requireNonEmpty(data.thumbnail, "Song thumbnail");
    if (data.artist !== undefined) this.artist = requireNonEmpty(data.artist, "Song artist");
    Object.freeze(this);
  }
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DisTubeError("INVALID_ARGUMENT", `${label} must be a non-empty string`);
  }
  return value;
}

export interface PlaylistData {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly source: string;
  /** Ordered and non-empty; core creates one QueueItem per Song in this order. */
  readonly songs: readonly Song[];
  readonly thumbnail?: string;
}

export class Playlist {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly source: string;
  readonly songs: readonly Song[];
  readonly thumbnail?: string;

  constructor(data: PlaylistData) {
    if (!data) throw new DisTubeError("INVALID_ARGUMENT", "Playlist data must be an object");
    this.id = requireNonEmpty(data.id, "Playlist id");
    this.name = requireNonEmpty(data.name, "Playlist name");
    this.url = requireNonEmpty(data.url, "Playlist url");
    this.source = requireNonEmpty(data.source, "Playlist source");
    if (!Array.isArray(data.songs) || data.songs.length === 0 || data.songs.some(song => !(song instanceof Song))) {
      throw new DisTubeError("INVALID_ARGUMENT", "Playlist songs must be a non-empty list of Songs");
    }
    this.songs = Object.freeze([...data.songs]);
    if (data.thumbnail !== undefined) this.thumbnail = requireNonEmpty(data.thumbnail, "Playlist thumbnail");
    Object.freeze(this);
  }
}

export interface QueueItemData<Metadata = unknown> {
  readonly song: Song;
  readonly metadata?: Metadata;
}

/**
 * One occurrence of a Song in a queue.
 *
 * `Metadata` is the client's caller-metadata type. It exists only in the type system: core stores whatever
 * value it is handed and never reads, copies, validates, or constrains it.
 */
export class QueueItem<Metadata = unknown> {
  /** Caller-owned reference; core stores it without reading, copying, or interpreting it. */
  readonly metadata: Metadata | undefined;
  readonly #id: string;
  readonly #song: Song;
  readonly #addedAt: Date;

  constructor(data: QueueItemData<Metadata>) {
    if (!(data?.song instanceof Song)) {
      throw new DisTubeError("INVALID_ARGUMENT", "QueueItem song must be a Song");
    }
    this.#id = randomUUID();
    this.#song = data.song;
    this.#addedAt = new Date();
    this.metadata = data.metadata;
    Object.freeze(this);
  }

  get id(): string {
    return this.#id;
  }

  get song(): Song {
    return this.#song;
  }

  get addedAt(): Date {
    return new Date(this.#addedAt.getTime());
  }
}
