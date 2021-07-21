import ytdl from "ytdl-core";
import { CustomPlugin, ExtractorPlugin, Queue, Song } from "./struct";
import { Guild, GuildMember, Message, Snowflake, StageChannel, User, VoiceChannel, VoiceState } from "discord.js";

export interface Filters {
  [x: string]: string;
}

export interface DisTubeOptions {
  /** DisTube plugins.*/
  plugins?: (CustomPlugin | ExtractorPlugin)[];
  /** If `true`, {@link DisTube#event:playSong} will not be emitted when looping a song or next song is the same as the previous one */
  emitNewSongOnly?: boolean;
  /** Whether or not leaving voice channel when the queue finishes. */
  leaveOnFinish?: boolean;
  /** Whether or not leaving voice channel after using {@link DisTube#stop} function. */
  leaveOnStop?: boolean;
  /** Whether or not leaving voice channel if the voice channel is empty after {@link DisTubeOptions}.emptyCooldown seconds. */
  leaveOnEmpty?: boolean;
  /** Built-in leave on empty cooldown in seconds (When leaveOnEmpty is true) */
  emptyCooldown?: number;
  /** Whether or not saving the previous songs of the queue and enable {@link DisTube#previous} method */
  savePreviousSongs?: boolean;
  /** Limit of search results emits in {@link DisTube#event:searchResult} event when {@link DisTube#play} method executed. If `searchSongs <= 1`, play the first result */
  searchSongs?: number;
  /** Built-in search cooldown in seconds (When `searchSongs` is bigger than 0) */
  searchCooldown?: number;
  /** YouTube cookies. Read how to get it in {@link https://github.com/fent/node-ytdl-core/blob/997efdd5dd9063363f6ef668bb364e83970756e7/example/cookies.js#L6-L12|YTDL's Example} */
  youtubeCookie?: string;
  /** If not given; ytdl-core will try to find it. You can find this by going to a video's watch page; viewing the source; and searching for "ID_TOKEN". */
  youtubeIdentityToken?: string;
  /** Whether or not using youtube-dl. */
  youtubeDL?: boolean;
  /** Whether or not updating youtube-dl automatically. */
  updateYouTubeDL?: boolean;
  /** Override {@link DefaultFilters} or add more ffmpeg filters. Example=`{ "Filter name"="Filter value"; "8d"="apulsator=hz=0.075" }` */
  customFilters?: Filters;
  /** `ytdl-core` options */
  ytdlOptions?: ytdl.downloadOptions;
  /** Whether or not playing age-restricted content and disabling safe search when using {@link DisTube#play} in non-NSFW channel. */
  nsfw?: boolean;
}

export type GuildIDResolvable = Queue | Snowflake | Message | VoiceChannel | StageChannel | VoiceState | Guild | string;

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
