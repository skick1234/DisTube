import type ytdl from "@distube/ytdl-core";
import type { CustomPlugin, DisTubeVoice, ExtractorPlugin, Playlist, Queue, SearchResult, Song } from ".";
import type {
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  Interaction,
  Message,
  Snowflake,
  User,
  VoiceBasedChannel,
  VoiceState,
} from "discord.js";

export type Awaitable<T = any> = T | PromiseLike<T>;

export type DisTubeVoiceEvents = {
  disconnect: (error?: Error) => Awaitable;
  error: (error: Error) => Awaitable;
  finish: () => Awaitable;
};

export type DisTubeEvents = {
  error: (channel: GuildTextBasedChannel | undefined, error: Error) => Awaitable;
  addList: (queue: Queue, playlist: Playlist) => Awaitable;
  addSong: (queue: Queue, song: Song) => Awaitable;
  playSong: (queue: Queue, song: Song) => Awaitable;
  finishSong: (queue: Queue, song: Song) => Awaitable;
  empty: (queue: Queue) => Awaitable;
  finish: (queue: Queue) => Awaitable;
  initQueue: (queue: Queue) => Awaitable;
  noRelated: (queue: Queue) => Awaitable;
  disconnect: (queue: Queue) => Awaitable;
  deleteQueue: (queue: Queue) => Awaitable;
  searchCancel: (message: Message<true>, query: string) => Awaitable;
  searchNoResult: (message: Message<true>, query: string) => Awaitable;
  searchDone: (message: Message<true>, answer: Message<true>, query: string) => Awaitable;
  searchInvalidAnswer: (message: Message<true>, answer: Message<true>, query: string) => Awaitable;
  searchResult: (message: Message<true>, results: SearchResult[], query: string) => Awaitable;
};

export interface Filter {
  name: string;
  value: string;
}

export type FilterResolvable = string | Filter;

export type Filters = Record<string, string>;

export interface DisTubeOptions {
  plugins?: (CustomPlugin | ExtractorPlugin)[];
  emitNewSongOnly?: boolean;
  leaveOnFinish?: boolean;
  leaveOnStop?: boolean;
  leaveOnEmpty?: boolean;
  emptyCooldown?: number;
  savePreviousSongs?: boolean;
  searchSongs?: number;
  searchCooldown?: number;
  youtubeCookie?: string;
  youtubeIdentityToken?: string;
  customFilters?: Filters;
  ytdlOptions?: ytdl.downloadOptions;
  nsfw?: boolean;
  emitAddSongWhenCreatingQueue?: boolean;
  emitAddListWhenCreatingQueue?: boolean;
}

export type GuildIdResolvable =
  | Queue
  | DisTubeVoice
  | Snowflake
  | Message
  | GuildTextBasedChannel
  | VoiceBasedChannel
  | VoiceState
  | Guild
  | GuildMember
  | Interaction
  | string;

export interface OtherSongInfo {
  src?: string;
  id?: string;
  title?: string;
  name?: string;
  is_live?: boolean;
  isLive?: boolean;
  _duration_raw?: string | number;
  duration?: string | number;
  webpage_url?: string;
  url: string;
  thumbnail?: string;
  related?: RelatedSong[];
  view_count?: string | number;
  views?: string | number;
  like_count?: string | number;
  likes?: string | number;
  dislike_count?: string | number;
  dislikes?: string | number;
  repost_count?: string | number;
  reposts?: string | number;
  uploader?: string | { name: string; url: string };
  uploader_url?: string;
  age_limit?: string | number;
  chapters?: Chapter[];
  age_restricted?: boolean;
}

export interface Chapter {
  title: string;
  start_time: number;
}

export interface PlaylistInfo {
  source: string;
  member?: GuildMember;
  user?: User;
  songs: Song[];
  name?: string;
  url?: string;
  thumbnail?: string;
}

export type RelatedSong = Omit<Song, "related">;

/**
 * @typedef {Object} PlayHandlerOptions
 * @param {Discord.BaseGuildTextChannel} [options.textChannel] The default text channel of the queue
 * @param {boolean} [options.skip=false] Skip the playing song (if exists) and play the added playlist instantly
 * @param {number} [options.position=0] Position of the song/playlist to add to the queue,
 * <= 0 to add to the end of the queue.
 */
export type PlayHandlerOptions = {
  skip?: boolean;
  position?: number;
  textChannel?: GuildTextBasedChannel;
};

/**
 * @typedef {Object} PlayOptions
 * @param {Discord.GuildMember} [member] Requested user (default is your bot)
 * @param {Discord.BaseGuildTextChannel} [textChannel] Default {@link Queue#textChannel}
 * @param {boolean} [skip=false]
 * Skip the playing song (if exists) and play the added song/playlist if `position` is 1.
 * If `position` is defined and not equal to 1, it will skip to the next song instead of the added song
 * @param {number} [position=0] Position of the song/playlist to add to the queue,
 * <= 0 to add to the end of the queue.
 * @param {Discord.Message} [message] Called message (For built-in search events. If this is a {@link https://developer.mozilla.org/en-US/docs/Glossary/Falsy|falsy value}, it will play the first result instead)
 * @param {*} [metadata] Optional metadata that can be attached to the song/playlist will be played,
 * This is useful for identification purposes when the song/playlist is passed around in events.
 * See {@link Song#metadata} or {@link Playlist#metadata}
 */
export interface PlayOptions extends PlayHandlerOptions, ResolveOptions<any> {
  message?: Message;
}

/**
 * @typedef {Object} ResolveOptions
 * @param {Discord.GuildMember} [member] Requested user
 * @param {*} [metadata] Metadata
 */
export interface ResolveOptions<T = unknown> {
  member?: GuildMember;
  metadata?: T;
}

/**
 * @typedef {ResolveOptions} ResolvePlaylistOptions
 * @param {string} [source] Source of the playlist
 */
export interface ResolvePlaylistOptions<T = unknown> extends ResolveOptions<T> {
  source?: string;
}

/**
 * @typedef {Object} CustomPlaylistOptions
 * @param {Discord.GuildMember} [message] A message from guild channel | A guild member
 * @param {Object} [properties] Additional properties such as `name`
 * @param {boolean} [parallel=true] Whether or not fetch the songs in parallel
 * @param {*} [metadata] Metadata
 */
export interface CustomPlaylistOptions {
  member?: GuildMember;
  properties?: Record<string, any>;
  parallel?: boolean;
  metadata?: any;
}
