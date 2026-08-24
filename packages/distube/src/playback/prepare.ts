import type { PlaybackPreparation, PlaybackResource, SourcePlugin } from "../contracts";
import { abortFailure, asError, ErrorCode } from "../errors";
import type { Song } from "../media";
import { disposeOnce } from "../utils/dispose";
import { throwIfAborted } from "./abort";
import { descend, exhaustedChain, findCandidates, newSearchChain, type SearchChain } from "./search";
import { requireSongOwner, type SourceCatalog } from "./sources";
import { validatePlaybackPreparation } from "./validation";

/** How many of a source's ranked candidates an explicit playback search consumes. */
const FALLBACK_CANDIDATES = 5;

export interface OwnedPlaybackResource {
  readonly resource: PlaybackResource;
  dispose(): Promise<void>;
}

export type DisposePlaybackResource = (resource: OwnedPlaybackResource, stage: string) => Promise<void>;

export async function preparePlaybackResource(
  song: Song,
  sources: SourceCatalog,
  signal: AbortSignal,
  report: (error: Error, stage: string) => void,
  dispose: DisposePlaybackResource,
): Promise<OwnedPlaybackResource> {
  const owner = requireSongOwner(song, sources);
  const initial = await callPreparation(owner, song, signal, dispose);
  if (initial.kind === "resource") return initial.resource;
  const chain = newSearchChain([owner.name], report);
  const resource = await substitute(initial.query, sources, signal, chain, dispose);
  if (resource) return resource;
  throw exhaustedChain(chain, "Explicit playback fallback was exhausted", "Playback fallback attempts failed");
}

/**
 * Plays the explicit search request from another source, following the same ordered chain rule.
 *
 * The chain settles on the first eligible source that ranks any candidate and tries at most that
 * source's first five. It does not move on to a later source when those candidates fail to prepare:
 * a source that answered the query owns the outcome. A candidate that itself asks for a search opens
 * a nested chain below it, which every source seen so far is excluded from.
 */
async function substitute(
  query: string,
  sources: SourceCatalog,
  signal: AbortSignal,
  chain: SearchChain,
  dispose: DisposePlaybackResource,
): Promise<OwnedPlaybackResource | undefined> {
  const hit = await findCandidates(query, sources, signal, chain, FALLBACK_CANDIDATES);
  if (!hit) return undefined;
  const nested = descend(chain, hit.source);
  for (const candidate of hit.candidates) {
    throwIfAborted(signal);
    try {
      const preparation = await callPreparation(hit.source, candidate, signal, dispose);
      if (preparation.kind === "resource") return preparation.resource;
      const substituted = await substitute(preparation.query, sources, signal, nested, dispose);
      if (substituted) return substituted;
    } catch (error: unknown) {
      throwIfAborted(signal);
      const failure = asError(error);
      chain.failures.push(failure);
      chain.report?.(failure, `fallback candidate (${hit.source.name})`);
    }
  }
  return undefined;
}

async function callPreparation(
  source: SourcePlugin,
  song: Song,
  signal: AbortSignal,
  dispose: DisposePlaybackResource,
): Promise<
  Readonly<{ kind: "resource"; resource: OwnedPlaybackResource }> | Readonly<{ kind: "search"; query: string }>
> {
  throwIfAborted(signal);
  let raw: unknown;
  try {
    raw = await source.preparePlayback(song, { signal });
  } catch (error: unknown) {
    throwIfAborted(signal);
    throw error;
  }
  const captured = capturePossibleResource(raw);
  let resourceDisposed = false;
  try {
    const preparation: PlaybackPreparation = validatePlaybackPreparation(raw, ErrorCode.SOURCE_FAILED);
    if (preparation.kind === "search") {
      throwIfAborted(signal);
      return preparation;
    }
    const owned = captured ?? ownResource(preparation.resource);
    if (signal.aborted) {
      resourceDisposed = true;
      await dispose(owned, "aborted playback preparation");
      throw abortFailure(signal.reason);
    }
    return Object.freeze({ kind: "resource", resource: owned });
  } catch (error: unknown) {
    if (captured && !resourceDisposed) await dispose(captured, "invalid playback preparation").catch(() => undefined);
    throw error;
  }
}

function capturePossibleResource(value: unknown): OwnedPlaybackResource | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const preparation = value as Readonly<Record<string, unknown>>;
  if (preparation.kind !== "resource" || typeof preparation.resource !== "object" || preparation.resource === null) {
    return undefined;
  }
  const resource = preparation.resource as Readonly<Record<string, unknown>>;
  if (typeof resource.dispose !== "function") return undefined;
  const once = disposeOnce(() =>
    Reflect.apply(resource.dispose as (...args: never[]) => unknown, preparation.resource, []),
  );
  return Object.freeze({ resource: preparation.resource as PlaybackResource, dispose: once.dispose });
}

function ownResource(resource: PlaybackResource): OwnedPlaybackResource {
  const once = disposeOnce(() => resource.dispose());
  return Object.freeze({ resource, dispose: once.dispose });
}
