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

/** Flattens a resolution or search result into the ordered Songs core enqueues. */
export function validateSourceSongs(
  value: Song | Playlist | readonly Song[],
  source: SourcePlugin,
  operation: "resolve" | "search" | "related",
  allowEmpty = false,
): readonly Song[] {
  const songs =
    value instanceof Song
      ? [value]
      : value instanceof Playlist
        ? [...value.songs]
        : Array.isArray(value)
          ? [...value]
          : [];
  if ((!allowEmpty && songs.length === 0) || songs.some(song => !(song instanceof Song))) {
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
