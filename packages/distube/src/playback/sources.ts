import type { SourcePlugin } from "../contracts";
import { DisTubeError, ErrorCode } from "../errors";
import { Playlist, Song } from "../media";

export interface SourceCatalog {
  readonly ordered: readonly SourcePlugin[];
  get(name: string): SourcePlugin | undefined;
}

export function createSourceCatalog(sources: readonly SourcePlugin[]): SourceCatalog {
  const ordered = Object.freeze([...sources]);
  const byName = new Map(ordered.map(source => [source.name, source]));
  return Object.freeze({ ordered, get: (name: string) => byName.get(name) });
}

/** Validates a non-declined result returned by SourcePlugin.resolve. */
export function validateResolvedMedia(value: unknown, source: SourcePlugin): Song | Playlist {
  if (!(value instanceof Song) && !(value instanceof Playlist)) {
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${source.name} returned an invalid resolve result`);
  }
  if (value.source !== source.name) {
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${source.name} returned media with mismatched source ownership`);
  }
  validateSourceSongs(value, source, "resolve");
  return value;
}

/** Validates one discovery operation before normalizing its result into Songs. */
export function validateSourceSongs(
  value: unknown,
  source: SourcePlugin,
  operation: "resolve" | "search" | "related",
): readonly Song[] {
  let songs: readonly Song[];
  if (operation === "search") {
    if (!Array.isArray(value)) {
      throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${source.name} returned invalid media from search`);
    }
    songs = [...value];
  } else if (operation === "resolve") {
    if (value instanceof Song) songs = [value];
    else if (value instanceof Playlist) songs = value.songs;
    else throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${source.name} returned invalid media from resolve`);
  } else {
    if (!(value instanceof Song)) {
      throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${source.name} returned invalid media from related`);
    }
    songs = [value];
  }

  // No emptiness check: resolve and related always hold a Song, since Playlist refuses an empty list.
  if (songs.some(song => !(song instanceof Song))) {
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${source.name} returned invalid media from ${operation}`);
  }
  if (songs.some(song => song.source !== source.name)) {
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${source.name} returned media with mismatched source ownership`);
  }
  return Object.freeze(songs);
}

/** The ordered Songs core enqueues for a resolved input. */
export function songsOf(value: Song | Playlist): readonly Song[] {
  return value instanceof Song ? Object.freeze([value]) : value.songs;
}

export function requireSongOwner(song: Song, sources: SourceCatalog): SourcePlugin {
  const owner = sources.get(song.source);
  if (!owner) {
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, "Song source does not name a configured SourcePlugin");
  }
  return owner;
}
