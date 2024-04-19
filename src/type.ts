import type ytdl from "@distube/ytdl-core";
import type {
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  Interaction,
  Message,
  Snowflake,
  VoiceBasedChannel,
  VoiceState,
} from "discord.js";
import type { CustomPlugin, DisTubeVoice, ExtractorPlugin, Playlist, Queue, SearchResult, Song } from ".";
import type { Cookie } from "@distube/ytdl-core";

export type Awaitable<T = any> = T | PromiseLike<T>;

// export type DisTubeEvents = {
//   [Events.ADD_LIST]: [queue: Queue, playlist: Playlist];
//   [Events.ADD_SONG]: [queue: Queue, song: Song];
//   [Events.DELETE_QUEUE]: [queue: Queue];
//   [Events.DISCONNECT]: [queue: Queue];
//   [Events.EMPTY]: [queue: Queue];
//   [Events.ERROR]: [channel: GuildTextBasedChannel | undefined, error: Error];
//   [Events.FFMPEG_DEBUG]: [debug: string];
//   [Events.FINISH]: [queue: Queue];
//   [Events.FINISH_SONG]: [queue: Queue, song: Song];
//   [Events.INIT_QUEUE]: [queue: Queue];
//   [Events.NO_RELATED]: [queue: Queue];
//   [Events.PLAY_SONG]: [queue: Queue, song: Song];
//   [Events.SEARCH_CANCEL]: [message: Message<true>, query: string];
//   [Events.SEARCH_DONE]: [message: Message<true>, answer: Message<true>, query: string];
//   [Events.SEARCH_INVALID_ANSWER]: [message: Message<true>, answer: Message<true>, query: string];
//   [Events.SEARCH_NO_RESULT]: [message: Message<true>, query: string];
//   [Events.SEARCH_RESULT]: [message: Message<true>, results: SearchResult[], query: string];
// };

export type DisTubeEvents = {
  addList: [queue: Queue, playlist: Playlist];
  addSong: [queue: Queue, song: Song];
  deleteQueue: [queue: Queue];
  disconnect: [queue: Queue];
  empty: [queue: Queue];
  error: [channel: GuildTextBasedChannel | undefined, error: Error];
  ffmpegDebug: [debug: string];
  finish: [queue: Queue];
  finishSong: [queue: Queue, song: Song];
  initQueue: [queue: Queue];
  noRelated: [queue: Queue];
  playSong: [queue: Queue, song: Song];
  searchCancel: [message: Message<true>, query: string];
  searchDone: [message: Message<true>, answer: Message<true>, query: string];
  searchInvalidAnswer: [message: Message<true>, answer: Message<true>, query: string];
  searchNoResult: [message: Message<true>, query: string];
  searchResult: [message: Message<true>, results: SearchResult[], query: string];
};

export type TypedDisTubeEvents = {
  [K in keyof DisTubeEvents]: (...args: DisTubeEvents[K]) => Awaitable;
};

export type DisTubeVoiceEvents = {
  disconnect: (error?: Error) => Awaitable;
  error: (error: Error) => Awaitable;
  finish: () => Awaitable;
};

/**
 * An FFmpeg audio filter object
 *
 * ```ts
 * {
 *   name:  "bassboost",
 *   value: "bass=g=10"
 * }
 * ```ts
 */
export interface Filter {
  /**
   * Name of the filter
   */
  name: string;
  /**
   * FFmpeg audio filter argument
   */
  value: string;
}

/**
 * Data that resolves to give an FFmpeg audio filter. This can be:
 *
 * - A name of a default filters or custom filters (`string`)
 * - A {@link Filter} object
 *
 * @see {@link defaultFilters}
 * @see {@link DisTubeOptions|DisTubeOptions.customFilters}
 */
export type FilterResolvable = string | Filter;

/**
 * FFmpeg Filters
 *
 * ```ts
 * {
 *   "Filter Name": "Filter Value",
 *   "bassboost":   "bass=g=10"
 * }
 * ```ts
 *
 * @see {@link defaultFilters}
 */
export type Filters = Record<string, string>;

/**
 * DisTube options
 */
export type DisTubeOptions = {
  /**
   * DisTube plugins
   */
  plugins?: (CustomPlugin | ExtractorPlugin)[];
  /**
   * Whether or not emitting {@link DisTube#playSong} event when looping a song
   * or next song is the same as the previous one
   */
  emitNewSongOnly?: boolean;
  /**
   * Whether or not leaving voice channel if the voice channel is empty after {@link
   * DisTubeOptions}.emptyCooldown seconds
   */
  leaveOnEmpty?: boolean;
  /**
   * Whether or not leaving voice channel when the queue ends
   */
  leaveOnFinish?: boolean;
  /**
   * Whether or not leaving voice channel after using {@link DisTube#stop} function
   */
  leaveOnStop?: boolean;
  /**
   * Built-in leave on empty cooldown in seconds (When leaveOnEmpty is true)
   */
  emptyCooldown?: number;
  /**
   * Whether or not saving the previous songs of the queue and enable {@link
   * DisTube#previous} method
   */
  savePreviousSongs?: boolean;
  /**
   * Limit of search results emits in {@link DisTube#searchResult} event when
   * {@link DisTube#play} method executed. If `searchSongs <= 1`, play the first
   * result
   */
  searchSongs?: number;
  /**
   * Built-in search cooldown in seconds (When searchSongs is bigger than 0)
   */
  searchCooldown?: number;
  /**
   * YouTube cookies. Guide: {@link
   * https://distube.js.org/#/docs/DisTube/main/general/cookie | YouTube Cookies}
   */
  youtubeCookie?: Cookie[] | string;
  /**
   * Override {@link defaultFilters} or add more ffmpeg filters
   */
  customFilters?: Filters;
  /**
   * `ytdl-core` get info options
   */
  ytdlOptions?: ytdl.downloadOptions;
  /**
   * Whether or not playing age-restricted content and disabling safe search in
   * non-NSFW channel
   */
  nsfw?: boolean;
  /**
   * Whether or not emitting `addSong` event when creating a new Queue
   */
  emitAddSongWhenCreatingQueue?: boolean;
  /**
   * Whether or not emitting `addList` event when creating a new Queue
   */
  emitAddListWhenCreatingQueue?: boolean;
  /**
   * Whether or not joining the new voice channel when using {@link DisTube#play}
   * method
   */
  joinNewVoiceChannel?: boolean;
  /**
   * Decide the {@link DisTubeStream#type} will be used (Not the same as {@link
   * DisTubeStream#type})
   */
  streamType?: StreamType;
  /**
   * Whether or not playing a song with direct link
   */
  directLink?: boolean;
  /**
   * FFmpeg path
   */
  ffmpegPath?: string;
  /**
   * FFmpeg default arguments
   */
  ffmpegDefaultArgs?: FFmpegOptions;
};

/**
 * Data that can be resolved to give a guild id string. This can be:
 *
 * - A guild id string | a guild {@link https://discord.js.org/#/docs/main/stable/class/Snowflake|Snowflake}
 * - A {@link https://discord.js.org/#/docs/main/stable/class/Guild | Guild}
 * - A {@link https://discord.js.org/#/docs/main/stable/class/Message | Message}
 * - A {@link https://discord.js.org/#/docs/main/stable/class/BaseGuildVoiceChannel
 *   | BaseGuildVoiceChannel}
 * - A {@link https://discord.js.org/#/docs/main/stable/class/BaseGuildTextChannel
 *   | BaseGuildTextChannel}
 * - A {@link https://discord.js.org/#/docs/main/stable/class/VoiceState |
 *   VoiceState}
 * - A {@link https://discord.js.org/#/docs/main/stable/class/GuildMember |
 *   GuildMember}
 * - A {@link https://discord.js.org/#/docs/main/stable/class/Interaction |
 *   Interaction}
 * - A {@link DisTubeVoice}
 * - A {@link Queue}
 */
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
  src: string;
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
  songs: Song[];
  name?: string;
  url?: string;
  thumbnail?: string;
  /**
   * @deprecated Use {@link PlaylistInfo#name}
   */
  title?: string;
  /**
   * @deprecated Use {@link PlaylistInfo#url}
   */
  webpage_url?: string;
}

export type RelatedSong = Omit<Song, "related">;

export type PlayHandlerOptions = {
  /**
   * [Default: false] Skip the playing song (if exists) and play the added playlist
   * instantly
   */
  skip?: boolean;
  /**
   * [Default: 0] Position of the song/playlist to add to the queue, \<= 0 to add to
   * the end of the queue
   */
  position?: number;
  /**
   * The default text channel of the queue
   */
  textChannel?: GuildTextBasedChannel;
};

export interface PlayOptions extends PlayHandlerOptions, ResolveOptions<any> {
  /**
   * Called message (For built-in search events. If this is a {@link
   * https://developer.mozilla.org/en-US/docs/Glossary/Falsy | falsy value}, it will
   * play the first result instead)
   */
  message?: Message;
}

export interface ResolveOptions<T = unknown> {
  /**
   * Requested user
   */
  member?: GuildMember;
  /**
   * Metadata
   */
  metadata?: T;
}

export interface ResolvePlaylistOptions<T = unknown> extends ResolveOptions<T> {
  /**
   * Source of the playlist
   */
  source?: string;
}

export interface CustomPlaylistOptions {
  /**
   * A guild member creating the playlist
   */
  member?: GuildMember;
  /**
   * Additional properties such as `name`
   */
  properties?: Record<string, any>;
  /**
   * Whether or not fetch the songs in parallel
   */
  parallel?: boolean;
  /**
   * Metadata
   */
  metadata?: any;
}

/**
 * The repeat mode of a {@link Queue}
 *
 * - `DISABLED` = 0
 * - `SONG` = 1
 * - `QUEUE` = 2
 */
export enum RepeatMode {
  DISABLED,
  SONG,
  QUEUE,
}

/**
 * All available plugin types:
 *
 * - `CUSTOM` = `"custom"`: {@link CustomPlugin}
 * - `EXTRACTOR` = `"extractor"`: {@link ExtractorPlugin}
 */
export enum PluginType {
  CUSTOM = "custom",
  EXTRACTOR = "extractor",
}

/**
 * Search result types:
 *
 * - `VIDEO` = `"video"`
 * - `PLAYLIST` = `"playlist"`
 */
export enum SearchResultType {
  VIDEO = "video",
  PLAYLIST = "playlist",
}

/**
 * Stream types:
 *
 * - `OPUS` = `0` (Better quality, use more resources - **Recommended**)
 * - `RAW` = `1` (Better performance, use less resources)
 */
export enum StreamType {
  OPUS,
  RAW,
}

export enum Events {
  ERROR = "error",
  ADD_LIST = "addList",
  ADD_SONG = "addSong",
  PLAY_SONG = "playSong",
  FINISH_SONG = "finishSong",
  EMPTY = "empty",
  FINISH = "finish",
  INIT_QUEUE = "initQueue",
  NO_RELATED = "noRelated",
  DISCONNECT = "disconnect",
  DELETE_QUEUE = "deleteQueue",
  SEARCH_CANCEL = "searchCancel",
  SEARCH_NO_RESULT = "searchNoResult",
  SEARCH_DONE = "searchDone",
  SEARCH_INVALID_ANSWER = "searchInvalidAnswer",
  SEARCH_RESULT = "searchResult",
  FFMPEG_DEBUG = "ffmpegDebug",
}

export type FFmpegOptions = Record<
  string,
  string | number | boolean | Array<string | null | undefined> | null | undefined
>;
