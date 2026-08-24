import type { SourcePlugin } from "../contracts";
import { asError, DisTubeError, ErrorCode } from "../errors";
import type { Song } from "../media";
import { throwIfAborted } from "./abort";
import { type SourceCatalog, validateSourceSongs } from "./sources";

/** The one source a chain settled on, and the candidates it ranked. */
export interface SearchHit {
  readonly source: SourcePlugin;
  readonly candidates: readonly Song[];
}

/** What a chain carries across its own nested searches, so no source is searched twice. */
export interface SearchChain {
  /** Sources excluded on this branch: the owner that asked, plus every source above it. */
  readonly visited: ReadonlySet<string>;
  /** Every source the whole chain has already searched, across branches. */
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

/** The chain continued past `source`, so a nested search below it excludes it too. */
export function descend(chain: SearchChain, source: SourcePlugin): SearchChain {
  return { ...chain, visited: new Set(chain.visited).add(source.name) };
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
  for (const source of sources.ordered) {
    throwIfAborted(signal);
    if (chain.visited.has(source.name) || chain.searched.has(source.name)) continue;
    chain.searched.add(source.name);
    let candidates: readonly Song[];
    try {
      candidates = validateSourceSongs(await source.search(query, { signal, limit }), source, "search", true);
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

/** The one failure an exhausted chain produces, carrying whatever causes it recorded and nothing more. */
export function exhaustedChain(chain: SearchChain, message: string, aggregateMessage: string): DisTubeError {
  return new DisTubeError(
    ErrorCode.SOURCE_FAILED,
    message,
    chain.failures.length > 0 ? { cause: new AggregateError(chain.failures, aggregateMessage) } : undefined,
  );
}
