import { asDisTubeError, ErrorCode } from "../errors";
import type { Song } from "../media";
import { throwIfAborted } from "./abort";
import { requireSongOwner, type SourceCatalog, validateSourceSongs } from "./sources";

/**
 * The autoplay continuation for `song`, taken only from the SourcePlugin that owns it.
 *
 * An absent `related` member or a declined lookup means no continuation; core never asks
 * another provider for related media. `exclude` is the queue's bounded history.
 */
export async function relatedSong(
  song: Song,
  sources: SourceCatalog,
  signal: AbortSignal,
  exclude: readonly Song[],
): Promise<Song | undefined> {
  throwIfAborted(signal);
  const owner = requireSongOwner(song, sources);
  if (!owner.related) return undefined;
  let related: unknown;
  try {
    related = await owner.related(song, { signal, exclude: Object.freeze([...exclude]) });
  } catch (error: unknown) {
    throwIfAborted(signal);
    throw asDisTubeError(ErrorCode.SOURCE_FAILED, `${owner.name} failed to find related media`, error);
  }
  throwIfAborted(signal);
  if (related === undefined) return undefined;
  return validateSourceSongs(related, owner, "related")[0];
}
