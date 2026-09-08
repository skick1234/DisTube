import type { ResolvableInput } from "../contracts";
import { asDisTubeError, DisTubeError, ErrorCode } from "../errors";
import { Playlist, Song } from "../media";
import { throwIfAborted } from "./abort";
import { exhaustedChain, findCandidates, newSearchChain } from "./search";
import { requireSongOwner, type SourceCatalog, validateResolvedMedia, validateSourceSongs } from "./sources";

/** How many of a source's ranked candidates query resolution consumes. */
const QUERY_CANDIDATES = 1;

/**
 * Routes an input to the SourcePlugin that owns it, in constructor order.
 *
 * Already-resolved media passes through after an ownership check. A string that parses as an absolute
 * `http:` or `https:` URL goes to `resolve` on each plugin until one does not decline; every other string
 * is a query and goes through the ordered source search chain. The two never mix: a URL every plugin
 * declined is a failure, not a query to search for.
 */
export async function resolveInput(
  input: ResolvableInput,
  sources: SourceCatalog,
  signal: AbortSignal,
): Promise<Song | Playlist> {
  throwIfAborted(signal);
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
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new DisTubeError("INVALID_ARGUMENT", "input must be a Song, a Playlist, a URL, or a non-empty query");
  }
  return isAbsoluteUrl(input) ? resolveUrl(input, sources, signal) : resolveQuery(input, sources, signal);
}

/**
 * Only an absolute `http:` or `https:` URL is offered to `resolve`; anything else the caller typed is a query.
 *
 * The scheme check is what makes the rule safe for real queries: `URL.canParse` alone accepts
 * `"artist: song title"` and `"c418:sweden"` as URLs, which would send a typed query down a path no
 * plugin can serve. A provider URI scheme such as `spotify:track:…` is a query for the same reason.
 */
function isAbsoluteUrl(input: string): boolean {
  const url = URL.parse(input);
  return url?.protocol === "http:" || url?.protocol === "https:";
}

async function resolveUrl(url: string, sources: SourceCatalog, signal: AbortSignal): Promise<Song | Playlist> {
  throwIfAborted(signal);
  for (const plugin of sources.ordered) {
    let result: unknown;
    try {
      result = await plugin.resolve(url, { signal });
    } catch (error: unknown) {
      throwIfAborted(signal);
      throw asDisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} failed to resolve source`, error);
    }
    throwIfAborted(signal);
    if (result === undefined) continue;
    const media = validateResolvedMedia(result, plugin);
    validateSourceSongs(media, plugin, "resolve");
    return media;
  }
  throw new DisTubeError(ErrorCode.SOURCE_FAILED, "No SourcePlugin resolved the source");
}

/** Exactly the first candidate of the first source that returns one; the rest never leave core. */
async function resolveQuery(query: string, sources: SourceCatalog, signal: AbortSignal): Promise<Song> {
  const chain = newSearchChain();
  const hit = await findCandidates(query, sources, signal, chain, QUERY_CANDIDATES);
  throwIfAborted(signal);
  const song = hit?.candidates[0];
  if (!song) throw exhaustedChain(chain, "No SourcePlugin found a result for the query", "Query searches failed");
  return song;
}
