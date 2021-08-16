import type ytdl from "@distube/ytdl-core";
import type { CustomPlugin, DisTubeVoice, ExtractorPlugin, Queue, Song } from ".";
import type {
  Guild,
  GuildMember,
  Interaction,
  Message,
  Snowflake,
  StageChannel,
  TextChannel,
  User,
  VoiceChannel,
  VoiceState,
} from "discord.js";

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

export type GuildIDResolvable =
  | Queue
  | DisTubeVoice
  | Snowflake
  | Message
  | VoiceChannel
  | StageChannel
  | VoiceState
  | Guild
  | TextChannel
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
