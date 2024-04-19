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

export type DisTubeVoiceEvents = {
  disconnect: (error?: Error) => Awaitable;
  error: (error: Error) => Awaitable;
  finish: () => Awaitable;
};

export type DisTubeEvents = {
  error: [channel: GuildTextBasedChannel | undefined, error: Error];
  addList: [queue: Queue, playlist: Playlist];
  addSong: [queue: Queue, song: Song];
  playSong: [queue: Queue, song: Song];
  finishSong: [queue: Queue, song: Song];
  empty: [queue: Queue];
  finish: [queue: Queue];
  initQueue: [queue: Queue];
  noRelated: [queue: Queue];
  disconnect: [queue: Queue];
  deleteQueue: [queue: Queue];
  searchCancel: [message: Message<true>, query: string];
  searchNoResult: [message: Message<true>, query: string];
  searchDone: [message: Message<true>, answer: Message<true>, query: string];
  searchInvalidAnswer: [message: Message<true>, answer: Message<true>, query: string];
  searchResult: [message: Message<true>, results: SearchResult[], query: string];
  ffmpegDebug: [debug: string];
};

export type TypedDisTubeEvents = {
  [K in keyof DisTubeEvents]: (...args: DisTubeEvents[K]) => Awaitable;
};

/**
 * @remarks
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
   * @remarks
   * Name of the filter
   */
  name: string;
  /**
   * @remarks
   * FFmpeg audio filter argument
   */
  value: string;
}

/**
 * @remarks
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
 * @remarks
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
 * @remarks
 * DisTube options
 */
export type DisTubeOptions = {
  /**
   * @remarks
   * DisTube plugins
   */
  plugins?: (CustomPlugin | ExtractorPlugin)[];
  /**
   * @remarks
   * Whether or not emitting {@link DisTube#(event:playSong)} event when looping a song
   * or next song is the same as the previous one
   */
  emitNewSongOnly?: boolean;
  /**
   * @remarks
   * Whether or not leaving voice channel if the voice channel is empty after {@link
   * DisTubeOptions}.emptyCooldown seconds
   */
  leaveOnEmpty?: boolean;
  /**
   * @remarks
   * Whether or not leaving voice channel when the queue ends
   */
  leaveOnFinish?: boolean;
  /**
   * @remarks
   * Whether or not leaving voice channel after using {@link DisTube#stop} function
   */
  leaveOnStop?: boolean;
  /**
   * @remarks
   * Built-in leave on empty cooldown in seconds (When leaveOnEmpty is true)
   */
  emptyCooldown?: number;
  /**
   * @remarks
   * Whether or not saving the previous songs of the queue and enable {@link
   * DisTube#previous} method
   */
  savePreviousSongs?: boolean;
  /**
   * @remarks
   * Limit of search results emits in {@link DisTube#(event:searchResult)} event when
   * {@link DisTube#play} method executed. If `searchSongs <= 1`, play the first
   * result
   */
  searchSongs?: number;
  /**
   * @remarks
   * Built-in search cooldown in seconds (When searchSongs is bigger than 0)
   */
  searchCooldown?: number;
  /**
   * @remarks
   * YouTube cookies. Guide: {@link
   * https://distube.js.org/#/docs/DisTube/main/general/cookie | YouTube Cookies}
   */
  youtubeCookie?: Cookie[] | string;
  /**
   * @remarks
   * Override {@link defaultFilters} or add more ffmpeg filters
   */
  customFilters?: Filters;
  /**
   * @remarks
   * `ytdl-core` get info options
   */
  ytdlOptions?: ytdl.downloadOptions;
  /**
   * @remarks
   * Whether or not playing age-restricted content and disabling safe search in
   * non-NSFW channel
   */
  nsfw?: boolean;
  /**
   * @remarks
   * Whether or not emitting `addSong` event when creating a new Queue
   */
  emitAddSongWhenCreatingQueue?: boolean;
  /**
   * @remarks
   * Whether or not emitting `addList` event when creating a new Queue
   */
  emitAddListWhenCreatingQueue?: boolean;
  /**
   * @remarks
   * Whether or not joining the new voice channel when using {@link DisTube#play}
   * method
   */
  joinNewVoiceChannel?: boolean;
  /**
   * @remarks
   * Decide the {@link DisTubeStream#type} will be used (Not the same as {@link
   * DisTubeStream#type})
   */
  streamType?: StreamType;
  /**
   * @remarks
   * Whether or not playing a song with direct link
   */
  directLink?: boolean;
  /**
   * @remarks
   * FFmpeg path
   */
  ffmpegPath?: string;
  /**
   * @remarks
   * FFmpeg default arguments
   */
  ffmpegDefaultArgs?: FFmpegOptions;
};

/**
 * @remarks
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
   * @remarks
   * [Default: false] Skip the playing song (if exists) and play the added playlist
   * instantly
   */
  skip?: boolean;
  /**
   * @remarks
   * [Default: 0] Position of the song/playlist to add to the queue, \<= 0 to add to
   * the end of the queue
   */
  position?: number;
  /**
   * @remarks
   * The default text channel of the queue
   */
  textChannel?: GuildTextBasedChannel;
};

export interface PlayOptions extends PlayHandlerOptions, ResolveOptions<any> {
  /**
   * @remarks
   * Called message (For built-in search events. If this is a {@link
   * https://developer.mozilla.org/en-US/docs/Glossary/Falsy | falsy value}, it will
   * play the first result instead)
   */
  message?: Message;
}

export interface ResolveOptions<T = unknown> {
  /**
   * @remarks
   * Requested user
   */
  member?: GuildMember;
  /**
   * @remarks
   * Metadata
   */
  metadata?: T;
}

export interface ResolvePlaylistOptions<T = unknown> extends ResolveOptions<T> {
  /**
   * @remarks
   * Source of the playlist
   */
  source?: string;
}

export interface CustomPlaylistOptions {
  /**
   * @remarks
   * A guild member creating the playlist
   */
  member?: GuildMember;
  /**
   * @remarks
   * Additional properties such as `name`
   */
  properties?: Record<string, any>;
  /**
   * @remarks
   * Whether or not fetch the songs in parallel
   */
  parallel?: boolean;
  /**
   * @remarks
   * Metadata
   */
  metadata?: any;
}

/**
 * @remarks
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
 * @remarks
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
 * @remarks
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
 * @remarks
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
}

export type FFmpegOptions = Record<
  string,
  string | number | boolean | Array<string | null | undefined> | null | undefined
>;
