import type { PlaybackPreparation, PlaybackResource, SourcePlugin } from "../contracts";
import { abortFailure, asDisTubeError, asError, DisTubeError, ErrorCode } from "../errors";
import type { Song } from "../media";
import { throwIfAborted } from "./abort";
import {
  capturePlaybackResource,
  consumePlaybackResource,
  type OwnedPlaybackResource,
  resourceErrorContext,
} from "./resource";
import { exhaustedChain, findCandidates, newSearchChain, type SearchChain } from "./search";
import { requireSongOwner, type SourceCatalog } from "./sources";
import { validatePlaybackPreparation } from "./validation";

/** How many of a source's ranked candidates an explicit playback search consumes. */
const FALLBACK_CANDIDATES = 5;
/** Candidate-specific preparation is bounded across every source in one fallback operation. */
const MAX_FALLBACK_PREPARATIONS = 25;

export type { OwnedPlaybackResource } from "./resource";

export type DisposePlaybackResource = (resource: OwnedPlaybackResource, stage: string) => Promise<void>;
/** Checks selected-engine compatibility without creating a Player or starting playback. */
export type PlaybackResourceCompatibility = (resource: PlaybackResource) => void;

export async function preparePlaybackResource(
  song: Song,
  sources: SourceCatalog,
  signal: AbortSignal,
  report: (error: Error, stage: string) => void,
  dispose: DisposePlaybackResource,
  isCompatible: PlaybackResourceCompatibility = () => undefined,
): Promise<OwnedPlaybackResource> {
  const owner = requireSongOwner(song, sources);
  const initial = await callPreparation(owner, song, signal, dispose);
  if (initial.kind === "resource") return initial.resource;
  const chain = newSearchChain([owner.name], report);
  const resource = await substitute(initial.query, sources, signal, chain, dispose, isCompatible);
  if (resource) return resource;
  throw exhaustedChain(chain, "Explicit playback fallback was exhausted", "Playback fallback attempts failed");
}

/**
 * Plays the explicit search request from another source, following the same ordered chain rule.
 *
 * The chain visits eligible sources in configured order. Each source contributes at most its first five
 * ranked candidates, and candidate preparation is capped across the whole operation. A candidate that
 * asks for another search is a decline within this operation, never a recursive lookup.
 */
async function substitute(
  query: string,
  sources: SourceCatalog,
  signal: AbortSignal,
  chain: SearchChain,
  dispose: DisposePlaybackResource,
  isCompatible: PlaybackResourceCompatibility,
): Promise<OwnedPlaybackResource | undefined> {
  const attempted = new Map<SourcePlugin, Set<string>>();
  let preparations = 0;
  while (preparations < MAX_FALLBACK_PREPARATIONS) {
    const hit = await findCandidates(query, sources, signal, chain, FALLBACK_CANDIDATES);
    if (!hit) return undefined;
    const sourceAttempts = attempted.get(hit.source) ?? new Set<string>();
    attempted.set(hit.source, sourceAttempts);
    for (const candidate of hit.candidates) {
      throwIfAborted(signal);
      if (preparations >= MAX_FALLBACK_PREPARATIONS) return undefined;
      if (sourceAttempts.has(candidate.id)) continue;
      sourceAttempts.add(candidate.id);
      preparations += 1;
      try {
        const preparation = await callPreparation(hit.source, candidate, signal, dispose, isCompatible);
        if (preparation.kind === "resource") return preparation.resource;
        // A metadata-only candidate cannot open another search branch. It consumed one attempt.
      } catch (error: unknown) {
        throwIfAborted(signal);
        const failure = asError(error);
        chain.failures.push(failure);
        chain.report?.(failure, `fallback candidate (${hit.source.name})`);
      }
    }
  }
  return undefined;
}

async function callPreparation(
  source: SourcePlugin,
  song: Song,
  signal: AbortSignal,
  dispose: DisposePlaybackResource,
  isCompatible: PlaybackResourceCompatibility = () => undefined,
): Promise<
  Readonly<{ kind: "resource"; resource: OwnedPlaybackResource }> | Readonly<{ kind: "search"; query: string }>
> {
  throwIfAborted(signal);
  let raw: unknown;
  try {
    raw = await source.stream(song, { signal });
  } catch (error: unknown) {
    throwIfAborted(signal);
    throw error;
  }
  let owned: OwnedPlaybackResource | undefined;
  try {
    const preparation: PlaybackPreparation = validatePlaybackPreparation(raw, ErrorCode.SOURCE_FAILED);
    if (preparation.kind === "search") {
      throwIfAborted(signal);
      return preparation;
    }
    const resourceValue = rawResource(raw);
    owned = consumePlaybackResource(resourceValue, ErrorCode.SOURCE_FAILED);
    isCompatible(owned.resource);
    if (signal.aborted) throw abortFailure(signal.reason);
    return Object.freeze({ kind: "resource", resource: owned });
  } catch (error: unknown) {
    const cleanup = owned ?? capturePlaybackResource(rawResource(raw));
    let cleanupFailure: Error | undefined;
    if (cleanup) {
      try {
        await dispose(cleanup, "invalid playback preparation");
      } catch (failure: unknown) {
        cleanupFailure = asError(failure, resourceErrorContext(cleanup.resource));
      }
    }
    const primary = signal.aborted ? abortFailure(signal.reason) : error;
    if (cleanupFailure) {
      const context = cleanup ? resourceErrorContext(cleanup.resource) : undefined;
      const failure = asDisTubeError(ErrorCode.SOURCE_FAILED, "Source failed to prepare playback", primary, context);
      throw new DisTubeError(failure.code, "Playback preparation and cleanup failed", {
        cause: new AggregateError([failure, cleanupFailure], "Playback preparation cleanup failures"),
      });
    }
    throw primary;
  }
}

function rawResource(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  return record.kind === "resource" ? record.resource : value;
}
