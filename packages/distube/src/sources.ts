import type { Engine, PlaybackResource, Plugin, ResolvableInput } from "./contracts";
import { abortError, DisTubeError, ErrorCode, requireQuery, throwIfAborted } from "./errors";
import { Playlist, Song } from "./media";

const SUGGESTION_LIMIT = 25;

const REWRAPPED: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.INVALID_ARGUMENT,
  ErrorCode.INVALID_STATE,
  ErrorCode.ABORTED,
]);

export interface SearchQuery {
  readonly source?: Plugin;
  readonly limit: number;
  readonly offset: number;
  readonly allowAgeRestricted?: boolean;
}

async function call<Value>(plugin: Plugin, signal: AbortSignal, operation: () => Promise<Value>): Promise<Value> {
  throwIfAborted(signal);
  try {
    return await operation();
  } catch (error: unknown) {
    if (signal.aborted) throw abortError(signal);
    if (DisTubeError.is(error) && !REWRAPPED.has(error.code)) throw error;
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} failed`, { cause: error, source: plugin.name });
  }
}

function owned<Media extends Song | Playlist>(plugin: Plugin, media: Media): Media {
  if (media.source !== plugin.name)
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} returned media from ${media.source}`);
  return media;
}

function withSongs(playlist: Playlist, songs: readonly Song[]): Playlist {
  return new Playlist({
    id: playlist.id,
    name: playlist.name,
    url: playlist.url,
    source: playlist.source,
    songs,
    thumbnail: playlist.thumbnail,
    pluginData: playlist.pluginData,
  });
}

function capped(media: Song | Playlist, maxPlaylistSongs: number): Song | Playlist {
  if (media instanceof Song || media.songs.length <= maxPlaylistSongs) return media;
  return withSongs(media, media.songs.slice(0, maxPlaylistSongs));
}

const allowed = (song: Song) => song.ageRestricted !== true;

function ageRestricted(media: Song | Playlist): DisTubeError {
  const kind = media instanceof Song ? "song" : "playlist";
  return new DisTubeError(ErrorCode.AGE_RESTRICTED, `The ${kind} is age-restricted`, {
    source: media.source,
    media: kind,
  });
}

export function validateInput(plugins: readonly Plugin[], input: ResolvableInput): void {
  if (typeof input === "string") {
    requireQuery(input);
    return;
  }
  if (!(input instanceof Song) && !(input instanceof Playlist))
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Input must be a Song, a Playlist, a URL or a query");
  if (songsOf(input).some(song => !ownerOf(plugins, song)))
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song source does not name a configured plugin");
}

export function songsOf(media: Song | Playlist): readonly Song[] {
  return media instanceof Song ? [media] : media.songs;
}

function ownerOf(plugins: readonly Plugin[], song: Song): Plugin | undefined {
  return plugins.find(plugin => plugin.name === song.source);
}

/** `URL.canParse` alone accepts `"artist: title"`, so only `http:` and `https:` count as URLs. */
function isAbsoluteUrl(input: string): boolean {
  const url = URL.parse(input);
  return url?.protocol === "http:" || url?.protocol === "https:";
}

export async function resolveInput(
  plugins: readonly Plugin[],
  input: ResolvableInput,
  signal: AbortSignal,
  maxPlaylistSongs: number,
  allowAgeRestricted: boolean,
): Promise<Song | Playlist> {
  const media = await mediaOf(plugins, input, signal, maxPlaylistSongs);
  if (allowAgeRestricted) return media;
  if (media instanceof Playlist) {
    const songs = media.songs.filter(allowed);
    if (songs.length === 0) throw ageRestricted(media);
    return songs.length === media.songs.length ? media : withSongs(media, songs);
  }
  const fromUrl = typeof input === "string" && isAbsoluteUrl(input);
  const song = fromUrl ? media : await lookedUp(plugins, media, signal, maxPlaylistSongs);
  if (!allowed(song)) throw ageRestricted(song);
  return song;
}

async function lookedUp(
  plugins: readonly Plugin[],
  song: Song,
  signal: AbortSignal,
  maxPlaylistSongs: number,
): Promise<Song> {
  const owner = ownerOf(plugins, song);
  const resolve = owner?.resolve?.bind(owner);
  if (song.ageRestricted !== undefined || !owner || !resolve) return song;
  const found = await call(owner, signal, () => resolve(song.url, { signal, maxPlaylistSongs }));
  return found instanceof Song ? owned(owner, found) : song;
}

async function mediaOf(
  plugins: readonly Plugin[],
  input: ResolvableInput,
  signal: AbortSignal,
  maxPlaylistSongs: number,
): Promise<Song | Playlist> {
  throwIfAborted(signal);
  if (typeof input !== "string") return input;
  if (isAbsoluteUrl(input)) {
    for (const plugin of plugins) {
      const resolve = plugin.resolve?.bind(plugin);
      if (!resolve) continue;
      const media = await call(plugin, signal, () => resolve(input, { signal, maxPlaylistSongs }));
      if (media) return capped(owned(plugin, media), maxPlaylistSongs);
    }
    throw new DisTubeError(ErrorCode.NO_RESULT, "No plugin resolved the URL", { query: input });
  }
  return firstFound(plugins, signal, "No plugin found a result for the query", input, async plugin => {
    const search = plugin.search?.bind(plugin);
    if (!search) return undefined;
    const [song] = await call(plugin, signal, () => search(input, { signal, limit: 1, offset: 0 }));
    return song && owned(plugin, song);
  });
}

async function firstFound<Value>(
  plugins: readonly Plugin[],
  signal: AbortSignal,
  message: string,
  query: string,
  find: (plugin: Plugin) => Promise<Value | undefined>,
): Promise<Value> {
  const failures: unknown[] = [];
  for (const plugin of plugins) {
    try {
      const value = await find(plugin);
      if (value !== undefined) return value;
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      failures.push(error);
    }
  }
  throw failures.length === 0
    ? new DisTubeError(ErrorCode.NO_RESULT, message, { query })
    : new DisTubeError(ErrorCode.SOURCE_FAILED, message, { cause: new AggregateError(failures, message), query });
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
    const kept = options.allowAgeRestricted ? songs : songs.filter(allowed);
    if (kept.length > 0) return kept.map(song => owned(plugin, song));
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
  fallback?: Song,
): Promise<Song | undefined> {
  const seedOwner = ownerOf(plugins, song);
  const useFallback = fallback !== undefined && !seedOwner?.related;
  const seed = useFallback ? fallback : song;
  const owner = useFallback ? ownerOf(plugins, fallback) : seedOwner;
  const related = owner?.related?.bind(owner);
  if (!owner || !related) return undefined;
  const next = await call(owner, signal, () => related(seed, { signal, exclude }));
  return next && owned(owner, next);
}

export interface PreparedSong {
  readonly resource: PlaybackResource;
  /** The candidate the search fallback prepared in place of the Song. */
  readonly fallback?: Song;
}

export async function prepareSong(
  plugins: readonly Plugin[],
  engine: Engine,
  song: Song,
  signal: AbortSignal,
): Promise<PreparedSong> {
  const owner = ownerOf(plugins, song);
  if (!owner) throw new DisTubeError(ErrorCode.SOURCE_FAILED, `No plugin named ${song.source} is configured`);
  const prepare = engine.prepare?.bind(engine);
  if (prepare) {
    const preparer = plugins.find(plugin => plugin.engine === engine) ?? owner;
    return { resource: await call(preparer, signal, () => prepare(song, { signal })) };
  }
  const stream = owner.stream?.bind(owner);
  if (stream) return { resource: await call(owner, signal, () => stream(song, { signal })) };
  const query = song.artist === undefined ? song.name : `${song.name} ${song.artist}`;
  return firstFound(plugins, signal, `No plugin could play ${song.name}`, query, async plugin => {
    const search = plugin.search?.bind(plugin);
    const prepareCandidate = plugin.stream?.bind(plugin);
    if (!search || !prepareCandidate) return undefined;
    const [found] = await call(plugin, signal, () => search(query, { signal, limit: 1, offset: 0 }));
    if (!found) return undefined;
    const fallback = owned(plugin, found);
    return { resource: await call(plugin, signal, () => prepareCandidate(fallback, { signal })), fallback };
  });
}

export async function disposeResource(resource: PlaybackResource): Promise<void> {
  if (resource.kind === "stream") resource.stream.destroy();
  await resource.dispose?.();
}
