import type { Engine, PlaybackPreparation, PlaybackResource, Plugin, ResolvableInput } from "./contracts";
import { abortError, DisTubeError, ErrorCode, throwIfAborted, toDisTubeError } from "./errors";
import { type Playlist, Song } from "./media";

const SUGGESTION_LIMIT = 25;

export interface SearchQuery {
  readonly source?: Plugin;
  readonly limit: number;
  readonly offset: number;
}

async function call<Value>(plugin: Plugin, signal: AbortSignal, operation: () => Promise<Value>): Promise<Value> {
  throwIfAborted(signal);
  try {
    return await operation();
  } catch (error: unknown) {
    if (signal.aborted) throw abortError(signal);
    throw toDisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} failed`, error, plugin.name);
  }
}

function owned<Media extends Song | Playlist>(plugin: Plugin, media: Media): Media {
  if (media.source !== plugin.name)
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} returned media from ${media.source}`);
  return media;
}

export function songsOf(media: Song | Playlist): readonly Song[] {
  return media instanceof Song ? [media] : media.songs;
}

export function ownerOf(plugins: readonly Plugin[], song: Song): Plugin | undefined {
  return plugins.find(plugin => plugin.name === song.source);
}

/** Only an absolute `http:` or `https:` URL goes to `resolve`; `URL.canParse` alone accepts `"artist: title"`. */
export function isAbsoluteUrl(input: string): boolean {
  const url = URL.parse(input);
  return url?.protocol === "http:" || url?.protocol === "https:";
}

function searchFirst(plugin: Plugin, query: string, signal: AbortSignal): Promise<Song | undefined> | undefined {
  const search = plugin.search?.bind(plugin);
  return (
    search &&
    call(plugin, signal, async () => {
      const [song] = await search(query, { signal, limit: 1, offset: 0 });
      return song && owned(plugin, song);
    })
  );
}

function streamOf(plugin: Plugin, song: Song, signal: AbortSignal): (() => Promise<PlaybackPreparation>) | undefined {
  const stream = plugin.stream?.bind(plugin);
  return stream && (() => call(plugin, signal, () => stream(song, { signal })));
}

function exhausted(failures: readonly unknown[], message: string): DisTubeError {
  return failures.length === 0
    ? new DisTubeError(ErrorCode.NO_RESULT, message)
    : new DisTubeError(ErrorCode.SOURCE_FAILED, message, { cause: new AggregateError(failures, message) });
}

export async function resolveInput(
  plugins: readonly Plugin[],
  input: ResolvableInput,
  signal: AbortSignal,
): Promise<Song | Playlist> {
  throwIfAborted(signal);
  if (typeof input !== "string") return input;
  if (isAbsoluteUrl(input)) {
    for (const plugin of plugins) {
      const resolve = plugin.resolve?.bind(plugin);
      if (!resolve) continue;
      const media = await call(plugin, signal, () => resolve(input, { signal }));
      if (media) return owned(plugin, media);
    }
    throw new DisTubeError(ErrorCode.NO_RESULT, "No plugin resolved the URL");
  }
  const failures: unknown[] = [];
  for (const plugin of plugins) {
    try {
      const song = await searchFirst(plugin, input, signal);
      if (song) return song;
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      failures.push(error);
    }
  }
  throw exhausted(failures, "No plugin found a result for the query");
}

export async function searchSongs(
  plugins: readonly Plugin[],
  query: string,
  options: SearchQuery,
  signal: AbortSignal,
): Promise<readonly Song[]> {
  if (options.source && !options.source.search)
    throw new DisTubeError(ErrorCode.UNSUPPORTED, `${options.source.name} does not support search`);
  for (const plugin of options.source ? [options.source] : plugins) {
    const search = plugin.search?.bind(plugin);
    if (!search) continue;
    const songs = await call(plugin, signal, () =>
      search(query, { signal, limit: options.limit, offset: options.offset }),
    );
    if (songs.length > 0) return songs.map(song => owned(plugin, song));
  }
  return [];
}

export async function suggestQueries(
  plugins: readonly Plugin[],
  query: string,
  source: Plugin | undefined,
  signal: AbortSignal,
): Promise<readonly string[]> {
  for (const plugin of source ? [source] : plugins) {
    const suggest = plugin.suggest?.bind(plugin);
    if (!suggest) continue;
    const suggestions = await call(plugin, signal, () => suggest(query, { signal }));
    if (suggestions.length > 0) return suggestions.slice(0, SUGGESTION_LIMIT);
  }
  return [];
}

export async function relatedSong(
  plugins: readonly Plugin[],
  song: Song,
  exclude: readonly Song[],
  signal: AbortSignal,
): Promise<Song | undefined> {
  const owner = ownerOf(plugins, song);
  const related = owner?.related?.bind(owner);
  if (!owner || !related) return undefined;
  const next = await call(owner, signal, () => related(song, { signal, exclude }));
  return next && owned(owner, next);
}

export async function prepareSong(
  plugins: readonly Plugin[],
  engine: Engine,
  song: Song,
  signal: AbortSignal,
): Promise<PlaybackResource> {
  const owner = ownerOf(plugins, song);
  if (!owner) throw new DisTubeError(ErrorCode.SOURCE_FAILED, `No plugin named ${song.source} is configured`);
  const stream = streamOf(owner, song, signal);
  const prepare = engine.prepare?.bind(engine);
  if (prepare) {
    const enginePlugin = plugins.find(plugin => plugin.engine === engine);
    return call(enginePlugin ?? owner, signal, () =>
      prepare(song, { signal, ...(stream && enginePlugin !== owner ? { stream } : {}) }),
    );
  }
  if (!stream) throw new DisTubeError(ErrorCode.UNSUPPORTED, `${owner.name} cannot stream`);
  const preparation = await stream();
  if (preparation.kind === "resource") return preparation.resource;

  const failures: unknown[] = [];
  for (const plugin of plugins) {
    if (plugin === owner) continue;
    try {
      const candidate = await searchFirst(plugin, preparation.query, signal);
      const result = candidate && (await streamOf(plugin, candidate, signal)?.());
      if (result?.kind === "resource") return result.resource;
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      failures.push(error);
    }
  }
  throw exhausted(failures, "No plugin could play the fallback query");
}

export async function disposeResource(resource: PlaybackResource): Promise<void> {
  if (resource.kind === "stream") resource.stream.destroy();
  await resource.dispose?.();
}
