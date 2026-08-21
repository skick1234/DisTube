import { randomUUID } from "node:crypto";
import { DisTubeError, ErrorCode } from "./errors";
import { immutableClone } from "./utils/immutable";

/** Who published a Song, when the provider names them. */
export interface SongUploader {
  readonly name: string;
  readonly url?: string;
}

export interface SongData {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly duration: number;
  readonly source: string;
  readonly thumbnail?: string;
  readonly uploader?: SongUploader;
  readonly isLive?: boolean;
  readonly views?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class Song {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly duration: number;
  readonly source: string;
  /** Display fields a provider may omit; absence reads as `undefined`. */
  readonly thumbnail?: string;
  readonly uploader?: SongUploader;
  readonly isLive?: boolean;
  readonly views?: number;
  readonly #metadata: Readonly<Record<string, unknown>>;

  constructor(data: SongData) {
    if (!data || typeof data.id !== "string" || data.id.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song id must be a non-empty string");
    }
    if (typeof data.title !== "string" || data.title.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song title must be a non-empty string");
    }
    if (typeof data.url !== "string" || data.url.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song url must be a non-empty string");
    }
    if (!Number.isFinite(data.duration) || data.duration < 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song duration must be a non-negative number");
    }
    if (typeof data.source !== "string" || data.source.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song source must be a non-empty string");
    }
    this.id = data.id;
    this.title = data.title;
    this.url = data.url;
    this.duration = data.duration;
    this.source = data.source;
    if (data.thumbnail !== undefined) this.thumbnail = requireNonEmpty(data.thumbnail, "Song thumbnail");
    if (data.uploader !== undefined) this.uploader = uploader(data.uploader);
    if (data.isLive !== undefined) {
      if (typeof data.isLive !== "boolean") {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song isLive must be a boolean");
      }
      this.isLive = data.isLive;
    }
    if (data.views !== undefined) {
      if (!Number.isFinite(data.views) || data.views < 0) {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song views must be a non-negative number");
      }
      this.views = data.views;
    }
    this.#metadata = immutableClone(data.metadata ?? {});
    Object.freeze(this);
  }

  get metadata(): Readonly<Record<string, unknown>> {
    return immutableClone(this.#metadata);
  }
}

function uploader(value: SongUploader): SongUploader {
  if (typeof value !== "object" || value === null) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song uploader must be an object");
  }
  const name = requireNonEmpty(value.name, "Song uploader name");
  const url = value.url === undefined ? undefined : requireNonEmpty(value.url, "Song uploader url");
  return Object.freeze(url === undefined ? { name } : { name, url });
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${label} must be a non-empty string`);
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
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class Playlist {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly source: string;
  readonly songs: readonly Song[];
  readonly thumbnail?: string;
  readonly #metadata: Readonly<Record<string, unknown>>;

  constructor(data: PlaylistData) {
    if (!data) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Playlist data must be an object");
    this.id = requireNonEmpty(data.id, "Playlist id");
    this.name = requireNonEmpty(data.name, "Playlist name");
    this.url = requireNonEmpty(data.url, "Playlist url");
    this.source = requireNonEmpty(data.source, "Playlist source");
    if (!Array.isArray(data.songs) || data.songs.length === 0 || data.songs.some(song => !(song instanceof Song))) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Playlist songs must be a non-empty list of Songs");
    }
    this.songs = Object.freeze([...data.songs]);
    if (data.thumbnail !== undefined) this.thumbnail = requireNonEmpty(data.thumbnail, "Playlist thumbnail");
    this.#metadata = immutableClone(data.metadata ?? {});
    Object.freeze(this);
  }

  get metadata(): Readonly<Record<string, unknown>> {
    return immutableClone(this.#metadata);
  }
}

export interface QueueItemData {
  readonly song: Song;
  metadata?: unknown;
}

export class QueueItem {
  /** Caller-owned reference; core stores it without reading, copying, or interpreting it. */
  metadata: unknown;
  readonly #id: string;
  readonly #song: Song;
  readonly #addedAt: Date;

  constructor(data: QueueItemData) {
    if (!(data?.song instanceof Song)) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "QueueItem song must be a Song");
    }
    this.#id = randomUUID();
    this.#song = data.song;
    this.#addedAt = new Date();
    this.metadata = data.metadata;
    // Sealed rather than frozen: every field except `metadata` is exposed through a getter.
    Object.seal(this);
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
