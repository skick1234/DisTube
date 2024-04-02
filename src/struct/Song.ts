import { Playlist } from "./Playlist";
import { DisTubeError, formatDuration, isMemberInstance, parseNumber, toSecond } from "..";
import type ytpl from "@distube/ytpl";
import type ytdl from "@distube/ytdl-core";
import type { GuildMember } from "discord.js";
import type { Chapter, OtherSongInfo, RelatedSong, SearchResult } from "..";

/**
 * @remarks
 * Class representing a song.
 *
 * <info>If {@link Song} is added from a YouTube {@link SearchResult} or {@link
 * Playlist}, some info will be missing to save your resources. It will be filled
 * when emitting {@link DisTube#playSong} event.
 *
 * Missing info: {@link Song#likes}, {@link Song#dislikes}, {@link Song#streamURL},
 * {@link Song#related}, {@link Song#chapters}, {@link Song#age_restricted}</info>
 */
export class Song<T = unknown> {
  source!: string;
  #metadata!: T;
  formats?: ytdl.videoFormat[];
  #member?: GuildMember;
  id?: string;
  name?: string;
  isLive!: boolean;
  duration!: number;
  formattedDuration?: string;
  url!: string;
  streamURL?: string;
  thumbnail?: string;
  related!: RelatedSong[];
  views!: number;
  likes!: number;
  dislikes!: number;
  uploader!: {
    name?: string;
    url?: string;
  };
  age_restricted!: boolean;
  chapters!: Chapter[];
  reposts!: number;
  #playlist?: Playlist;
  /**
   * @remarks
   * Create a Song
   *
   * @param info             - Raw info
   * @param options          - Optional options
   */
  constructor(
    info:
      | ytdl.videoInfo
      | SearchResult
      | OtherSongInfo
      | ytdl.relatedVideo
      | RelatedSong
      | ytpl.result["items"][number],
    options: {
      member?: GuildMember;
      source?: string;
      metadata?: T;
    } = {},
  ) {
    const { member, source, metadata } = { source: "youtube", ...options };

    if (
      typeof source !== "string" ||
      ((info as OtherSongInfo).src && typeof (info as OtherSongInfo).src !== "string")
    ) {
      throw new DisTubeError("INVALID_TYPE", "string", source, "source");
    }
    /**
     * @remarks
     * The source of the song
     */
    this.source = ((info as OtherSongInfo)?.src || source).toLowerCase();
    /**
     * @remarks
     * Optional metadata that can be used to identify the song. This is attached by the
     * {@link DisTube#play} method.
     */
    this.metadata = metadata as T;
    this.member = member;
    if (this.source === "youtube") {
      this._patchYouTube(info as ytdl.videoInfo);
    } else {
      this._patchOther(info as OtherSongInfo);
    }
  }

  _patchYouTube(i: ytdl.videoInfo | SearchResult) {
    // FIXME
    const info = i as any;
    if (info.full === true) {
      /**
       * @remarks
       * Stream formats (Available if the song is from YouTube and playing)
       */
      this.formats = info.formats;
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const err = require("@distube/ytdl-core/lib/utils").playError(info.player_response, [
        "UNPLAYABLE",
        "LIVE_STREAM_OFFLINE",
        "LOGIN_REQUIRED",
      ]);
      if (err) throw err;

      if (!info.formats?.length) throw new DisTubeError("UNAVAILABLE_VIDEO");
    }
    const details = info.videoDetails || info;
    /**
     * @remarks
     * YouTube video id
     */
    this.id = details.videoId || details.id;
    /**
     * @remarks
     * Song name.
     */
    this.name = details.title || details.name;
    /**
     * @remarks
     * Indicates if the video is an active live.
     */
    this.isLive = Boolean(details.isLive);
    /**
     * @remarks
     * Song duration.
     */
    this.duration = this.isLive ? 0 : toSecond(details.lengthSeconds || details.length_seconds || details.duration);
    /**
     * @remarks
     * Formatted duration string (`hh:mm:ss`, `mm:ss` or `Live`).
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    /**
     * @remarks
     * Song URL.
     */
    this.url = `https://www.youtube.com/watch?v=${this.id}`;
    /**
     * @remarks
     * Stream / Download URL (Available if the song is playing)
     */
    this.streamURL = undefined;
    /**
     * @remarks
     * Song thumbnail.
     */
    this.thumbnail =
      details.thumbnails?.sort((a: any, b: any) => b.width - a.width)?.[0]?.url ||
      details.thumbnail?.url ||
      details.thumbnail;
    /**
     * @remarks
     * Related songs (without {@link Song#related} properties)
     */
    this.related = info?.related_videos || details.related || [];
    if (!Array.isArray(this.related)) throw new DisTubeError("INVALID_TYPE", "Array", this.related, "Song#related");
    this.related = this.related.map((v: any) => new Song(v, { source: this.source, metadata: this.metadata }));
    /**
     * @remarks
     * Song views count
     */
    this.views = parseNumber(details.viewCount || details.view_count || details.views);
    /**
     * @remarks
     * Song like count
     */
    this.likes = parseNumber(details.likes);
    /**
     * @remarks
     * Song dislike count
     */
    this.dislikes = parseNumber(details.dislikes);
    /**
     * @remarks
     * Song uploader
     */
    this.uploader = {
      name: info.uploader?.name || details.author?.name,
      url: info.uploader?.url || details.author?.channel_url || details.author?.url,
    };
    /**
     * @remarks
     * Whether or not an age-restricted content
     */
    this.age_restricted = Boolean(details.age_restricted);

    /**
     * @remarks
     * Chapters information (YouTube only)
     */
    this.chapters = details.chapters || [];
    /**
     * @remarks
     * Song repost count
     */
    this.reposts = 0;
  }

  /**
   * @remarks
   * Patch data from other source
   *
   * @param info - Video info
   */
  _patchOther(info: OtherSongInfo) {
    this.id = info.id;
    this.name = info.title || info.name;
    this.isLive = Boolean(info.is_live || info.isLive);
    this.duration = this.isLive ? 0 : toSecond(info._duration_raw || info.duration);
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    this.url = info.webpage_url || info.url;
    this.thumbnail = info.thumbnail;
    this.related = info.related || [];
    if (!Array.isArray(this.related)) throw new DisTubeError("INVALID_TYPE", "Array", this.related, "Song#related");
    this.related = this.related.map(i => new Song(i, { source: this.source, metadata: this.metadata }));
    this.views = parseNumber(info.view_count || info.views);
    this.likes = parseNumber(info.like_count || info.likes);
    this.dislikes = parseNumber(info.dislike_count || info.dislikes);
    this.reposts = parseNumber(info.repost_count || info.reposts);
    if (typeof info.uploader === "string") {
      this.uploader = {
        name: info.uploader,
        url: info.uploader_url,
      };
    } else {
      this.uploader = {
        name: info.uploader?.name,
        url: info.uploader?.url,
      };
    }
    this.age_restricted = info.age_restricted || (Boolean(info.age_limit) && parseNumber(info.age_limit) >= 18);
    this.chapters = info.chapters || [];
  }

  /**
   * @remarks
   * The playlist added this song
   */
  get playlist() {
    return this.#playlist;
  }

  set playlist(playlist: Playlist | undefined) {
    if (!(playlist instanceof Playlist)) throw new DisTubeError("INVALID_TYPE", "Playlist", playlist, "Song#playlist");
    this.#playlist = playlist;
    this.member = playlist.member;
  }

  /**
   * @remarks
   * User requested.
   */
  get member() {
    return this.#member;
  }

  set member(member: GuildMember | undefined) {
    if (isMemberInstance(member)) this.#member = member;
  }

  /**
   * @remarks
   * User requested.
   */
  get user() {
    return this.member?.user;
  }

  get metadata() {
    return this.#metadata;
  }

  set metadata(metadata: T) {
    this.#metadata = metadata;
  }
}
