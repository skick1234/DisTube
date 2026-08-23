import type { PlaybackPreparation, PlaybackResource, SourcePlugin } from "../contracts";
import { asError, DisTubeError, ErrorCode } from "../errors";
import type { Song } from "../media";
import { disposeOnce } from "../utils/dispose";
import { requireSongOwner, type SourceCatalog, validateSourceSongs } from "./sources";
import { validatePlaybackPreparation } from "./validation";

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
  const failures: Error[] = [];
  const searched = new Set<string>([owner.name]);
  const resource = await searchSources(
    initial.query,
    sources,
    signal,
    new Set([owner.name]),
    searched,
    failures,
    report,
    dispose,
  );
  if (resource) return resource;
  throw new DisTubeError(ErrorCode.SOURCE_FAILED, "Explicit playback fallback was exhausted", {
    cause: new AggregateError(failures, "Playback fallback attempts failed"),
  });
}

async function searchSources(
  query: string,
  sources: SourceCatalog,
  signal: AbortSignal,
  visited: ReadonlySet<string>,
  searched: Set<string>,
  failures: Error[],
  report: (error: Error, stage: string) => void,
  dispose: DisposePlaybackResource,
): Promise<OwnedPlaybackResource | undefined> {
  for (const source of sources.ordered) {
    throwIfAborted(signal);
    if (visited.has(source.name) || searched.has(source.name)) continue;
    searched.add(source.name);
    const branchVisited = new Set(visited).add(source.name);
    let candidates: readonly Song[];
    try {
      const result = await source.search(query, { signal });
      candidates = validateSourceSongs(result, source, "search", true);
    } catch (error: unknown) {
      throwIfAborted(signal);
      const failure = asError(error);
      failures.push(failure);
      report(failure, `fallback search (${source.name})`);
      continue;
    }
    for (const candidate of candidates.slice(0, 5)) {
      throwIfAborted(signal);
      try {
        const preparation = await callPreparation(source, candidate, signal, dispose);
        if (preparation.kind === "resource") return preparation.resource;
        const nested = await searchSources(
          preparation.query,
          sources,
          signal,
          branchVisited,
          searched,
          failures,
          report,
          dispose,
        );
        if (nested) return nested;
      } catch (error: unknown) {
        throwIfAborted(signal);
        const failure = asError(error);
        failures.push(failure);
        report(failure, `fallback candidate (${source.name})`);
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
      throw signal.reason instanceof Error ? signal.reason : new Error("Playback preparation aborted");
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Playback preparation aborted");
}
