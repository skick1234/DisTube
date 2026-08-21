import type { Song } from "../media";
import { requireSongOwner, type SourceCatalog, validateSourceSongs } from "./sources";

/**
 * The autoplay continuation for `song`, taken only from the SourcePlugin that owns it.
 *
 * An absent `related` member or a declined lookup means no continuation; core never asks
 * another provider for related media.
 */
export async function relatedSong(song: Song, sources: SourceCatalog, signal: AbortSignal): Promise<Song | undefined> {
  const owner = requireSongOwner(song, sources);
  if (!owner.related) return undefined;
  const related = await owner.related(song, { signal });
  if (!related) return undefined;
  return validateSourceSongs(related, owner, "related")[0];
}
