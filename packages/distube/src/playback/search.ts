import type { SourcePlugin } from "../contracts";
import { asDisTubeError, asError, DisTubeError, ErrorCode } from "../errors";
import type { Song } from "../media";
import { throwIfAborted } from "./abort";
import { type SourceCatalog, validateSourceSongs } from "./sources";

/** The one source a chain settled on, and the candidates it ranked. */
export interface SearchHit {
  readonly source: SourcePlugin;
  readonly candidates: readonly Song[];
}

/** State shared across ordered searches, so no source is searched twice. */
export interface SearchChain {
  /** Sources excluded from this operation, including the owner that requested fallback. */
  readonly visited: ReadonlySet<string>;
  /** Every source the operation has already searched. */
  readonly searched: Set<string>;
  /** Causes recorded from sources whose search threw; the chain fails with these, not on them. */
  readonly failures: Error[];
  /** Reports a recorded cause that no public error will carry. */
  readonly report?: (error: Error, stage: string) => void;
}

/** A fresh chain that has visited nothing. */
export function newSearchChain(visited: Iterable<string> = [], report?: SearchChain["report"]): SearchChain {
  return { visited: new Set(visited), searched: new Set(visited), failures: [], report };
}

/**
 * The one ordered source search rule, shared by query resolution and explicit playback fallback.
 *
 * Visits configured sources in constructor order, skips any this chain already visited, searches each
 * eligible source at most once, and stops at the first source that returns a candidate. A source that
 * throws is recorded and the chain moves on: only exhaustion is a failure, which is why this returns
 * `undefined` rather than throwing. Callers differ only in `limit`, which is how many candidates the
 * owning requirement lets them consume.
 */
export async function findCandidates(
  query: string,
  sources: SourceCatalog,
  signal: AbortSignal,
  chain: SearchChain,
  limit: number,
): Promise<SearchHit | undefined> {
  throwIfAborted(signal);
  for (const source of sources.ordered) {
    throwIfAborted(signal);
    if (chain.visited.has(source.name) || chain.searched.has(source.name)) continue;
    if (!source.search) continue;
    chain.searched.add(source.name);
    let candidates: readonly Song[];
    try {
      candidates = validateSourceSongs(await source.search(query, { signal, limit }), source, "search");
    } catch (error: unknown) {
      throwIfAborted(signal);
      const failure = asError(error);
      chain.failures.push(failure);
      chain.report?.(failure, `search (${source.name})`);
      continue;
    }
    throwIfAborted(signal);
    if (candidates.length === 0) continue;
    return Object.freeze({ source, candidates: Object.freeze(candidates.slice(0, limit)) });
  }
  return undefined;
}

/**
 * The one failure an exhausted chain produces, carrying whatever causes it recorded and nothing more.
 *
 * A chain every source declined cleanly is `NO_RESULT`; a chain that recorded provider failures is
 * `SOURCE_FAILED` with those causes.
 */
export function exhaustedChain(chain: SearchChain, message: string, aggregateMessage: string): DisTubeError {
  // Providers can reuse an Error across attempts. Preserve its first position without duplicates.
  const failures = [...new Set(chain.failures)];
  if (failures.length === 0) return new DisTubeError(ErrorCode.NO_RESULT, message);
  return new DisTubeError(ErrorCode.SOURCE_FAILED, message, { cause: new AggregateError(failures, aggregateMessage) });
}

/**
 * `distube.search`: one source when given, otherwise the first non-empty result in constructor order.
 *
 * Unlike query resolution, a source that throws fails the call; the bot asked for that provider's ranking
 * and a silent fallback would hide the failure it needs to show.
 */
export async function searchSongs(
  query: string,
  sources: SourceCatalog,
  options: Readonly<{ source?: SourcePlugin; limit?: number; offset?: number }>,
  signal: AbortSignal,
): Promise<readonly Song[]> {
  const candidates = options.source ? [options.source] : sources.ordered;
  const pagination = {
    signal,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.offset === undefined ? {} : { offset: options.offset }),
  };
  for (const source of candidates) {
    throwIfAborted(signal);
    if (!source.search) {
      if (options.source) throw new DisTubeError(ErrorCode.UNSUPPORTED, `${source.name} does not support search`);
      continue;
    }
    let result: unknown;
    try {
      result = await source.search(query, pagination);
    } catch (error: unknown) {
      throwIfAborted(signal);
      throw asDisTubeError(ErrorCode.SOURCE_FAILED, `${source.name} failed to search`, error);
    }
    const songs = validateSourceSongs(result, source, "search");
    throwIfAborted(signal);
    if (songs.length > 0) return songs;
  }
  return Object.freeze([]);
}

/** `distube.getSuggestions`: the first configured source with `suggest` that returns a non-empty list. */
export async function suggestQueries(
  query: string,
  sources: SourceCatalog,
  source: SourcePlugin | undefined,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const candidates = source ? [source] : sources.ordered;
  for (const candidate of candidates) {
    throwIfAborted(signal);
    if (!candidate.suggest) continue;
    let suggestions: unknown;
    try {
      suggestions = await candidate.suggest(query, { signal });
    } catch (error: unknown) {
      throwIfAborted(signal);
      throw asDisTubeError(ErrorCode.SOURCE_FAILED, `${candidate.name} failed to suggest`, error);
    }
    throwIfAborted(signal);
    if (!Array.isArray(suggestions) || suggestions.some(entry => typeof entry !== "string")) {
      throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${candidate.name} returned invalid suggestions`);
    }
    if (suggestions.length > 0) return Object.freeze(suggestions.slice(0, 25));
  }
  return Object.freeze([]);
}
