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

export interface CustomPluginPlayOptions {
  skip?: boolean;
  position?: number;
  member?: GuildMember;
  textChannel?: GuildTextBasedChannel;
  metadata?: any;
}
