import { randomUUID } from "node:crypto";
import { DisTubeError, requireBoolean } from "./errors";

/** One image of a Song's or Playlist's artwork. A size is absent when the provider does not report it. */
export interface Thumbnail {
  readonly url: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export type SongData<PluginData = unknown> = {
  readonly source: string;
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly duration?: number;
  /** Worst first, best last; `thumbnail` reads the last. Known widths must not decrease. */
  readonly thumbnails?: readonly Thumbnail[];
  readonly artist?: string;
  /** True when the provider marks the media for adults, false when it says it is not, absent when it did not say. Core never acts on it. */
  readonly ageRestricted?: boolean;
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
  readonly thumbnails: readonly Thumbnail[];
  readonly artist?: string;
  /** True when the provider marks the media for adults, false when it says it is not, absent when it did not say. Core never acts on it. */
  readonly ageRestricted?: boolean;
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
    this.thumbnails = thumbnailList(data.thumbnails, "Song");
    if (data.artist !== undefined) this.artist = requireNonEmpty(data.artist, "Song artist");
    if (data.ageRestricted !== undefined) {
      requireBoolean(data.ageRestricted, "Song ageRestricted");
      this.ageRestricted = data.ageRestricted;
    }
    this.pluginData = data.pluginData as PluginData;
    Object.freeze(this);
  }

  /** The best image: the last of `thumbnails`. */
  get thumbnail(): string | undefined {
    return this.thumbnails.at(-1)?.url;
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
function formatDuration(seconds: number): string {
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

function requireSize(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new DisTubeError("INVALID_ARGUMENT", `${label} must be a positive integer`);
  }
  return value;
}

function thumbnailList(value: unknown, owner: string): readonly Thumbnail[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new DisTubeError("INVALID_ARGUMENT", `${owner} thumbnails must be a list`);
  let widest = 0;
  return Object.freeze(
    value.map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) {
        throw new DisTubeError("INVALID_ARGUMENT", `${owner} thumbnail must be an object`);
      }
      const { url, width, height } = entry as Record<string, unknown>;
      const thumbnail: { url: string; width?: number; height?: number } = {
        url: requireNonEmpty(url, `${owner} thumbnail url`),
      };
      if (width !== undefined) {
        thumbnail.width = requireSize(width, `${owner} thumbnail width`);
        if (thumbnail.width < widest) {
          throw new DisTubeError("INVALID_ARGUMENT", `${owner} thumbnail widths must not decrease`);
        }
        widest = thumbnail.width;
      }
      if (height !== undefined) thumbnail.height = requireSize(height, `${owner} thumbnail height`);
      return Object.freeze(thumbnail);
    }),
  );
}

export type PlaylistData<PluginData = unknown, ListData = unknown> = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly source: string;
  /** Ordered and non-empty; core creates one QueueItem per Song in this order. */
  readonly songs: readonly Song<PluginData>[];
  /** Worst first, best last; `thumbnail` reads the last. Known widths must not decrease. */
  readonly thumbnails?: readonly Thumbnail[];
  /** Provider-owned playlist data. Core never reads it. */
  readonly pluginData?: ListData;
} & (undefined extends ListData ? unknown : { readonly pluginData: ListData });

/**
 * Immutable provider playlist. `PluginData` types its Songs' `pluginData` and `ListData` the playlist's own; both are
 * declared by the owning plugin, and core never reads them.
 */
export class Playlist<PluginData = unknown, ListData = unknown> {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly source: string;
  readonly songs: readonly Song<PluginData>[];
  readonly thumbnails: readonly Thumbnail[];
  readonly pluginData: ListData;

  constructor(data: PlaylistData<PluginData, ListData>) {
    if (!data) throw new DisTubeError("INVALID_ARGUMENT", "Playlist data must be an object");
    this.id = requireNonEmpty(data.id, "Playlist id");
    this.name = requireNonEmpty(data.name, "Playlist name");
    this.url = requireNonEmpty(data.url, "Playlist url");
    this.source = requireNonEmpty(data.source, "Playlist source");
    if (!Array.isArray(data.songs) || data.songs.length === 0 || data.songs.some(song => !(song instanceof Song))) {
      throw new DisTubeError("INVALID_ARGUMENT", "Playlist songs must be a non-empty list of Songs");
    }
    this.songs = Object.freeze([...data.songs]);
    this.thumbnails = thumbnailList(data.thumbnails, "Playlist");
    this.pluginData = data.pluginData as ListData;
    Object.freeze(this);
  }

  /** The best image: the last of `thumbnails`. */
  get thumbnail(): string | undefined {
    return this.thumbnails.at(-1)?.url;
  }

  /** Sum of Song durations in seconds; an unknown duration counts as 0. */
  get duration(): number {
    return this.songs.reduce((total, song) => total + (song.duration ?? 0), 0);
  }

  get formattedDuration(): string {
    return formatDuration(this.duration);
  }
}

/**
 * One occurrence of a Song in a queue, frozen when created.
 *
 * `Metadata` is the client's caller-metadata type. Core stores the caller's reference and never reads it.
 */
export interface QueueItem<Metadata = unknown> {
  readonly id: string;
  readonly song: Song;
  /** For an autoplay item, the `metadata` of the item it was related from. */
  readonly metadata: Metadata;
  /** Whether autoplay added this occurrence rather than a caller. Repeat and `previous` replays keep it. */
  readonly autoplay: boolean;
  /** Creation time in epoch milliseconds. */
  readonly addedAt: number;
}

export function queueItem<Metadata>(song: Song, metadata: Metadata, autoplay = false): QueueItem<Metadata> {
  return Object.freeze({ id: randomUUID(), song, metadata, autoplay, addedAt: Date.now() });
}
