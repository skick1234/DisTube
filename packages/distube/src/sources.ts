import type { Engine, PlaybackResource, Plugin, PluginReport, ResolvableInput } from "./contracts";
import { abortError, DisTubeError, ErrorCode, fromIntegration, requireQuery, throwIfAborted } from "./errors";
import { Playlist, Song } from "./media";

const SUGGESTION_LIMIT = 25;
const FALLBACK_CANDIDATES = 5;
const DURATION_TOLERANCE = 5;

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
    throw fromIntegration(ErrorCode.SOURCE_FAILED, `${plugin.name} failed`, error, plugin.name);
  }
}

function lookup<Value>(
  plugin: Plugin,
  signal: AbortSignal,
  report: ItemReporter,
  operation: (report: PluginReport) => Promise<Value>,
): Promise<Value> {
  let open = true;
  const close = (): void => {
    open = false;
  };
  const settled = call(plugin, signal, () =>
    operation(diagnostic => {
      if (open) report(plugin.name, diagnostic);
    }),
  );
  settled.then(close, close);
  return settled;
}

function owned<Media extends Song | Playlist>(plugin: Plugin, media: Media): Media {
  const foreign = [media, ...songsOf(media)].find(found => found.source !== plugin.name);
  if (foreign) throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} returned media from ${foreign.source}`);
  return media;
}

function withSongs(playlist: Playlist, songs: readonly Song[]): Playlist {
  return new Playlist({
    id: playlist.id,
    name: playlist.name,
    url: playlist.url,
    source: playlist.source,
    songs,
    thumbnails: playlist.thumbnails,
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
  report: ItemReporter,
): Promise<Song | Playlist> {
  const media = await mediaOf(plugins, input, signal, maxPlaylistSongs, report);
  if (allowAgeRestricted) return media;
  if (media instanceof Playlist) {
    const songs = media.songs.filter(allowed);
    if (songs.length === 0) throw ageRestricted(media);
    return songs.length === media.songs.length ? media : withSongs(media, songs);
  }
  const fromUrl = typeof input === "string" && isAbsoluteUrl(input);
  const song = fromUrl ? media : await lookedUp(plugins, media, signal, maxPlaylistSongs, report);
  if (!allowed(song)) throw ageRestricted(song);
  return song;
}

async function lookedUp(
  plugins: readonly Plugin[],
  song: Song,
  signal: AbortSignal,
  maxPlaylistSongs: number,
  report: ItemReporter,
): Promise<Song> {
  const owner = ownerOf(plugins, song);
  const resolve = owner?.resolve?.bind(owner);
  if (song.ageRestricted !== undefined || !owner || !resolve) return song;
  const found = await lookup(owner, signal, report, bound =>
    resolve(song.url, { signal, maxPlaylistSongs, report: bound }),
  );
  return found instanceof Song ? owned(owner, found) : song;
}

async function mediaOf(
  plugins: readonly Plugin[],
  input: ResolvableInput,
  signal: AbortSignal,
  maxPlaylistSongs: number,
  report: ItemReporter,
): Promise<Song | Playlist> {
  throwIfAborted(signal);
  if (typeof input !== "string") return input;
  if (isAbsoluteUrl(input)) {
    for (const plugin of plugins) {
      const resolve = plugin.resolve?.bind(plugin);
      if (!resolve) continue;
      const media = await lookup(plugin, signal, report, bound =>
        resolve(input, { signal, maxPlaylistSongs, report: bound }),
      );
      if (media) return capped(owned(plugin, media), maxPlaylistSongs);
    }
    throw new DisTubeError(ErrorCode.NO_RESULT, "No plugin resolved the URL", { query: input });
  }
  return firstFound(plugins, signal, "No plugin found a result for the query", input, async plugin => {
    const search = plugin.search?.bind(plugin);
    if (!search) return undefined;
    const [song] = await lookup(plugin, signal, report, bound =>
      search(input, { signal, limit: 1, offset: 0, report: bound }),
    );
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
  if (failures.length === 0) throw new DisTubeError(ErrorCode.NO_RESULT, message, { query });
  const source = shared(failures.map(failure => (DisTubeError.is(failure) ? failure.source : undefined)));
  const transient = failures.every(failure => DisTubeError.is(failure) && failure.transient);
  throw new DisTubeError(
    shared(failures.map(failure => (DisTubeError.is(failure) ? failure.code : undefined))) ?? ErrorCode.SOURCE_FAILED,
    message,
    { cause: new AggregateError(failures, message), query, transient, ...(source === undefined ? {} : { source }) },
  );
}

function shared<Value>(values: readonly Value[]): Value | undefined {
  const [first] = values;
  return values.every(value => value === first) ? first : undefined;
}

export async function searchSongs(
  plugins: readonly Plugin[],
  query: string,
  options: SearchQuery,
  signal: AbortSignal,
  report: ItemReporter,
): Promise<readonly Song[]> {
  if (options.source && !options.source.search)
    throw new DisTubeError(ErrorCode.UNSUPPORTED, `${options.source.name} does not support search`);
  for (const plugin of options.source ? [options.source] : plugins) {
    const search = plugin.search?.bind(plugin);
    if (!search) continue;
    const songs = await lookup(plugin, signal, report, bound =>
      search(query, {
        signal,
        limit: options.limit,
        offset: options.offset,
        allowAgeRestricted: options.allowAgeRestricted ?? false,
        report: bound,
      }),
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
  report: ItemReporter,
): Promise<readonly string[]> {
  for (const plugin of source ? [source] : plugins) {
    const suggest = plugin.suggest?.bind(plugin);
    if (!suggest) continue;
    const suggestions = await lookup(plugin, signal, report, bound => suggest(query, { signal, report: bound }));
    if (suggestions.length > 0) return suggestions.slice(0, SUGGESTION_LIMIT);
  }
  return [];
}

const noRelated = (source: string, message: string) => new DisTubeError(ErrorCode.NO_RESULT, message, { source });

export async function relatedSong(
  plugins: readonly Plugin[],
  song: Song,
  exclude: readonly Song[],
  allowAgeRestricted: boolean,
  signal: AbortSignal,
  report: ItemReporter,
  fallback?: Song,
): Promise<Song> {
  const seedOwner = ownerOf(plugins, song);
  const useFallback = fallback !== undefined && !seedOwner?.related;
  const seed = useFallback ? fallback : song;
  const owner = useFallback ? ownerOf(plugins, fallback) : seedOwner;
  const related = owner?.related?.bind(owner);
  if (!owner || !related) throw noRelated(seed.source, `${seed.source} has no related lookup`);
  const next = await lookup(owner, signal, report, bound =>
    related(seed, { signal, exclude, allowAgeRestricted, report: bound }),
  );
  if (!next) throw noRelated(owner.name, `${owner.name} returned no related Song`);
  return owned(owner, next);
}

export function allowedRelated(song: Song, allowAgeRestricted: boolean): Song {
  if (!allowAgeRestricted && !allowed(song))
    throw noRelated(song.source, `${song.source} returned an age-restricted related Song`);
  return song;
}

export interface PreparedSong {
  readonly resource: PlaybackResource;
  readonly source: string;
  readonly fallback?: Song;
}

export type ReportedDiagnostic = Parameters<PluginReport>[0];

export type ItemReporter = (plugin: string, diagnostic: ReportedDiagnostic) => void;

const closeReports = new WeakMap<PlaybackResource, () => void>();

async function streamed(
  plugin: Plugin,
  song: Song,
  signal: AbortSignal,
  report: ItemReporter,
  stream: NonNullable<Plugin["stream"]>,
): Promise<PlaybackResource> {
  let open = true;
  const bound = (diagnostic: ReportedDiagnostic): void => {
    if (open) report(plugin.name, diagnostic);
  };
  try {
    const resource = await call(plugin, signal, () => stream(song, { signal, report: bound }));
    closeReports.set(resource, () => {
      open = false;
    });
    return resource;
  } catch (error: unknown) {
    open = false;
    throw error;
  }
}

function closest(song: Song, candidates: readonly Song[]): Song | undefined {
  const target = song.duration;
  if (!target) return candidates[0];
  const gap = (candidate: Song) => (candidate.duration ? Math.abs(candidate.duration - target) : Infinity);
  return candidates
    .filter(candidate => !candidate.duration || gap(candidate) <= DURATION_TOLERANCE)
    .reduce<Song | undefined>((best, candidate) => (best && gap(best) <= gap(candidate) ? best : candidate), undefined);
}

export async function prepareSong(
  plugins: readonly Plugin[],
  engine: Engine,
  song: Song,
  signal: AbortSignal,
  allowAgeRestricted: boolean,
  report: ItemReporter,
): Promise<PreparedSong> {
  const owner = ownerOf(plugins, song);
  if (!owner) throw new DisTubeError(ErrorCode.SOURCE_FAILED, `No plugin named ${song.source} is configured`);
  const prepare = engine.prepare?.bind(engine);
  if (prepare) {
    const preparer = plugins.find(plugin => plugin.engine === engine) ?? owner;
    return { resource: await call(preparer, signal, () => prepare(song, { signal })), source: preparer.name };
  }
  const stream = owner.stream?.bind(owner);
  if (stream) return { resource: await streamed(owner, song, signal, report, stream), source: owner.name };
  const query = song.artist === undefined ? song.name : `${song.name} ${song.artist}`;
  return firstFound(plugins, signal, `No plugin could play ${song.name}`, query, async plugin => {
    const search = plugin.search?.bind(plugin);
    const prepareCandidate = plugin.stream?.bind(plugin);
    if (!search || !prepareCandidate) return undefined;
    const found = await lookup(plugin, signal, report, bound =>
      search(query, { signal, limit: FALLBACK_CANDIDATES, offset: 0, allowAgeRestricted, report: bound }),
    );
    const candidate = closest(song, allowAgeRestricted ? found : found.filter(allowed));
    if (!candidate) return undefined;
    const fallback = owned(plugin, candidate);
    return {
      resource: await streamed(plugin, fallback, signal, report, prepareCandidate),
      source: plugin.name,
      fallback,
    };
  });
}

export async function disposeResource(resource: PlaybackResource): Promise<void> {
  closeReports.get(resource)?.();
  if (resource.kind === "stream") resource.stream.destroy();
  await resource.dispose?.();
}
