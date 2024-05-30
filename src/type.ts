import type {
  DisTubeError,
  DisTubeVoice,
  ExtractorPlugin,
  InfoExtractorPlugin,
  PlayableExtractorPlugin,
  Playlist,
  Queue,
  Song,
} from ".";
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

export type Awaitable<T = any> = T | PromiseLike<T>;

export type DisTubeEvents = {
  [Events.ADD_LIST]: [queue: Queue, playlist: Playlist];
  [Events.ADD_SONG]: [queue: Queue, song: Song];
  [Events.DELETE_QUEUE]: [queue: Queue];
  [Events.DISCONNECT]: [queue: Queue];
  [Events.EMPTY]: [queue: Queue];
  [Events.ERROR]: [error: Error, queue: Queue, song: Song | undefined];
  [Events.FFMPEG_DEBUG]: [debug: string];
  [Events.FINISH]: [queue: Queue];
  [Events.FINISH_SONG]: [queue: Queue, song: Song];
  [Events.INIT_QUEUE]: [queue: Queue];
  [Events.NO_RELATED]: [queue: Queue, error: DisTubeError];
  [Events.PLAY_SONG]: [queue: Queue, song: Song];
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
 * - A name of a default filters or custom filters (`string`)
 * - A {@link Filter} object
 * @see {@link defaultFilters}
 * @see {@link DisTubeOptions|DisTubeOptions.customFilters}
 */
export type FilterResolvable = string | Filter;

/**
 * FFmpeg Filters
 * ```ts
 * {
 *   "Filter Name": "Filter Value",
 *   "bassboost":   "bass=g=10"
 * }
 * ```
 * @see {@link defaultFilters}
 */
export type Filters = Record<string, string>;

/**
 * DisTube options
 */
export type DisTubeOptions = {
  /**
   * DisTube plugins.
   * The order of this effects the priority of the plugins when verifying the input.
   */
  plugins?: DisTubePlugin[];
  /**
   * Whether or not emitting {@link DisTube#playSong} event when looping a song
   * or next song is the same as the previous one
   */
  emitNewSongOnly?: boolean;
  /**
   * Whether or not saving the previous songs of the queue and enable {@link
   * DisTube#previous} method. Disable it may help to reduce the memory usage
   */
  savePreviousSongs?: boolean;
  /**
   * Override {@link defaultFilters} or add more ffmpeg filters
   */
  customFilters?: Filters;
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
   * FFmpeg options
   */
  ffmpeg?: {
    /**
     * FFmpeg path
     */
    path?: string;
    /**
     * FFmpeg default arguments
     */
    args?: Partial<FFmpegArgs>;
  };
};

/**
 * Data that can be resolved to give a guild id string. This can be:
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

export interface SongInfo {
  plugin: DisTubePlugin | null;
  source: string;
  playFromSource: boolean;
  streamURL?: string;
  id?: string;
  name?: string;
  isLive?: boolean;
  duration?: number;
  url?: string;
  thumbnail?: string;
  views?: number;
  likes?: number;
  dislikes?: number;
  reposts?: number;
  uploader?: {
    name?: string;
    url?: string;
  };
  ageRestricted?: boolean;
}

export interface PlaylistInfo {
  source: string;
  songs: Song[];
  id?: string;
  name?: string;
  url?: string;
  thumbnail?: string;
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

export interface PlayOptions<T = unknown> extends PlayHandlerOptions, ResolveOptions<T> {
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
   * Whether or not fetch the songs in parallel
   */
  parallel?: boolean;
  /**
   * Metadata
   */
  metadata?: any;
  /**
   * Playlist name
   */
  name?: string;
  /**
   * Playlist source
   */
  source?: string;
  /**
   * Playlist url
   */
  url?: string;
  /**
   * Playlist thumbnail
   */
  thumbnail?: string;
}

/**
 * The repeat mode of a {@link Queue}
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
 * - `EXTRACTOR` = `"extractor"`: {@link ExtractorPlugin}
 * - `INFO_EXTRACTOR` = `"info-extractor"`: {@link InfoExtractorPlugin}
 * - `PLAYABLE_EXTRACTOR` = `"playable-extractor"`: {@link PlayableExtractorPlugin}
 */
export enum PluginType {
  EXTRACTOR = "extractor",
  INFO_EXTRACTOR = "info-extractor",
  PLAYABLE_EXTRACTOR = "playable-extractor",
}

export type DisTubePlugin = ExtractorPlugin | InfoExtractorPlugin | PlayableExtractorPlugin;

/**
 * Stream types:
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
  FFMPEG_DEBUG = "ffmpegDebug",
}

export type FFmpegArg = Record<string, string | number | boolean | Array<string | null | undefined> | null | undefined>;

export type FFmpegArgs = {
  global: FFmpegArg;
  input: FFmpegArg;
  output: FFmpegArg;
};

export type FFmpegOptions = {
  path: string;
  args: FFmpegArgs;
};
