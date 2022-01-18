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

type Awaitable = Promise<void> | void;

export type DisTubeVoiceEvents = {
  disconnect: (error?: Error) => Awaitable;
  error: (error: Error) => Awaitable;
  finish: () => Awaitable;
};

export type DisTubeEvents = {
  /** Emitted when DisTube encounters an error. */
  error: (channel: GuildTextBasedChannel, error: Error) => Awaitable;
  /** Emitted after DisTube add a new playlist to the playing {@link Queue}. */
  addList: (queue: Queue, playlist: Playlist) => Awaitable;
  /** Emitted after DisTube add a new song to the playing {@link Queue}. */
  addSong: (queue: Queue, song: Song) => Awaitable;
  /**
   * Emitted when DisTube play a song.
   *
   * If {@link DisTubeOptions.emitNewSongOnly} is `true`,
   * this event is not emitted when looping a song or next song is the previous one.
   */
  playSong: (queue: Queue, song: Song) => Awaitable;
  /** Emitted when DisTube finished a song. */
  finishSong: (queue: Queue, song: Song) => Awaitable;

  /**
   * Emitted when there is no user in the voice channel,
   * {@link DisTubeOptions.leaveOnEmpty} is `true` and there is a playing queue.
   *
   * If there is no playing queue (stopped and {@link DisTubeOptions.leaveOnStop} is `false`),
   * it will leave the channel without emitting this event.
   */
  empty: (queue: Queue) => Awaitable;
  /**
   * Emitted when there is no more song in the queue and {@link Queue#autoplay} is `false`.
   * DisTube will leave voice channel if {@link DisTubeOptions.leaveOnFinish} is `true`.
   */
  finish: (queue: Queue) => Awaitable;
  /** Emitted when DisTube initialize a queue to change queue default properties. */
  initQueue: (queue: Queue) => Awaitable;
  /**
   * Emitted when {@link Queue#autoplay} is `true`, {@link Queue#songs} is empty,
   * and DisTube cannot find related songs to play.
   */
  noRelated: (queue: Queue) => Awaitable;
  /** Emitted when the bot is disconnected to a voice channel. */
  disconnect: (queue: Queue) => Awaitable;
  /** Emitted when a {@link Queue} is deleted with any reasons. */
  deleteQueue: (queue: Queue) => Awaitable;

  /**
   * Emitted when {@link DisTubeOptions.searchSongs} bigger than 0,
   * and the search canceled due to {@link DisTubeOptions.searchTimeout}.
   */
  searchCancel: (message: Message<true>, query: string) => Awaitable;
  /** Emitted when DisTube cannot find any results for the query. */
  searchNoResult: (message: Message<true>, query: string) => Awaitable;

  /**
   * Emitted when {@link DisTubeOptions.searchSongs} bigger than 0,
   * and after the user chose a search result to play.
   */
  searchDone: (message: Message<true>, answer: Message<true>, query: string) => Awaitable;
  /**
   * Emitted when {@link DisTubeOptions.searchSongs} bigger than 0,
   * and the search canceled due to user's next message is not a number or out of results range.
   */
  searchInvalidAnswer: (message: Message<true>, answer: Message<true>, query: string) => Awaitable;
  /**
   * Emitted when {@link DisTubeOptions.searchSongs} bigger than 0,
   * and song param of {@link DisTube#play} is invalid url.
   * DisTube will wait for user's next message to choose a song manually.
   *
   * Safe search is enabled
   * if {@link DisTubeOptions.nsfw} is disabled and the message's channel is not a nsfw channel.
   */
  searchResult: (message: Message<true>, results: SearchResult[], query: string) => Awaitable;
};

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
  youtubeDL?: boolean;
  updateYouTubeDL?: boolean;
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
  related?: Song[];
  view_count?: string | number;
  views?: string | number;
  like_count?: string | number;
  likes?: string | number;
  dislike_count?: string | number;
  dislikes?: string | number;
  repost_count?: string | number;
  reposts?: string | number;
  uploader?: string;
  uploader_url?: string;
  age_limit?: string | number;
  chapters?: Chapter[];
  age_restricted?: boolean;
}

export interface Chapter {
  /** Chapter title */
  title: string;
  /** Chapter start time in seconds */
  start_time: number;
}

export interface PlaylistInfo {
  /** The source of the playlist */
  source: string;
  /**
   * User requested.
   */
  member?: GuildMember;
  /**
   * User requested.
   */
  user?: User;
  /** Playlist songs. */
  songs: Song[];
  /**
   * Playlist name.
   */
  name?: string;
  /**
   * Playlist URL.
   */
  url?: string;
  /**
   * Playlist thumbnail.
   */
  thumbnail?: string;
}
