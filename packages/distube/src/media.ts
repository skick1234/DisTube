import { randomUUID } from "node:crypto";
import { DisTubeError } from "./errors";

export type SongData<PluginData = unknown> = {
  readonly source: string;
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly duration?: number;
  readonly thumbnail?: string;
  readonly artist?: string;
  /** Provider-owned display and identity data. Core never reads it. */
  readonly pluginData?: PluginData;
} & (undefined extends PluginData ? unknown : { readonly pluginData: PluginData });

/**
 * Immutable provider-neutral identity and display fields.
 *
 * `PluginData` is declared by the owning SourcePlugin; core stores the reference and never reads,
 * clones, freezes or interprets it.
 */
export class Song<PluginData = unknown> {
  readonly source: string;
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly duration?: number;
  readonly thumbnail?: string;
  readonly artist?: string;
  readonly pluginData: PluginData;

  constructor(data: SongData<PluginData>) {
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
    this.pluginData = data.pluginData as PluginData;
    Object.freeze(this);
  }

  /** `h:mm:ss` from one hour, otherwise `m:ss`; `Live` when no duration is known. */
  get formattedDuration(): string {
    return this.duration === undefined || this.duration === 0 ? "Live" : formatDuration(this.duration);
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Deterministic, locale-independent clock rendering of whole seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DisTubeError("INVALID_ARGUMENT", `${label} must be a non-empty string`);
  }
  return value;
}

export interface PlaylistData<PluginData = unknown> {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly source: string;
  /** Ordered and non-empty; core creates one QueueItem per Song in this order. */
  readonly songs: readonly Song<PluginData>[];
  readonly thumbnail?: string;
  /** Provider-owned playlist data. Core never reads it. */
  readonly pluginData?: unknown;
}

/** Immutable provider playlist. `PluginData` types its Songs; the playlist's own slot stays provider-narrowed. */
export class Playlist<PluginData = unknown> {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly source: string;
  readonly songs: readonly Song<PluginData>[];
  readonly thumbnail?: string;
  readonly pluginData: unknown;

  constructor(data: PlaylistData<PluginData>) {
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
    this.pluginData = data.pluginData;
    Object.freeze(this);
  }

  /** Sum of Song durations in seconds; an unknown duration counts as 0. */
  get duration(): number {
    return this.songs.reduce((total, song) => total + (song.duration ?? 0), 0);
  }

  get formattedDuration(): string {
    return formatDuration(this.duration);
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
