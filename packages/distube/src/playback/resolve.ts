import type { ResolvableInput } from "../contracts";
import { asDisTubeError, DisTubeError, ErrorCode } from "../errors";
import { Playlist, Song } from "../media";
import { requireSongOwner, type SourceCatalog, validateSourceSongs } from "./sources";

/**
 * Routes an input to the SourcePlugin that owns it, in constructor order.
 *
 * Already-resolved media passes through after an ownership check; a URL goes to the first plugin
 * that does not decline it.
 */
export async function resolveInput(
  input: ResolvableInput,
  sources: SourceCatalog,
  signal: AbortSignal,
): Promise<Song | Playlist> {
  if (input instanceof Song) {
    requireSongOwner(input, sources);
    throwIfAborted(signal);
    return input;
  }
  if (input instanceof Playlist) {
    for (const song of input.songs) requireSongOwner(song, sources);
    throwIfAborted(signal);
    return input;
  }
  if (typeof input !== "string" || input.length === 0) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "input must be a Song, a Playlist, or a non-empty URL");
  }
  for (const plugin of sources.ordered) {
    let result: Song | Playlist | undefined;
    try {
      result = await plugin.resolve(input, { signal });
    } catch (error: unknown) {
      throwIfAborted(signal);
      throw asDisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} failed to resolve source`, error);
    }
    throwIfAborted(signal);
    if (!result) continue;
    validateSourceSongs(result, plugin, "resolve");
    return result;
  }
  throw new DisTubeError(ErrorCode.SOURCE_FAILED, "No SourcePlugin resolved the source");
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Queue operation aborted");
}
