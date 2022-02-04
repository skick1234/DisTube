import { Playlist } from "./Playlist";
import { DisTubeError, formatDuration, isMemberInstance, parseNumber, toSecond } from "..";
import type ytdl from "@distube/ytdl-core";
import type { GuildMember } from "discord.js";
import type { Chapter, OtherSongInfo, RelatedSong, SearchResult } from "..";

/**
 * Class representing a song.
 *
 * <info>If {@link Song} is added from a YouTube {@link SearchResult} or {@link Playlist},
 * some info will be missing to save your resources. It will be filled when emitting {@link DisTube#playSong} event.
 *
 * Missing info: {@link Song#likes}, {@link Song#dislikes}, {@link Song#streamURL},
 * {@link Song#related}, {@link Song#chapters}, {@link Song#age_restricted}</info>
 * @template T - The type for the metadata (if any) of the song
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
   * Create a Song
   * @param {ytdl.videoInfo|SearchResult|OtherSongInfo} info Raw info
   * @param {Object} [options] Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {string} [options.source="youtube"] Song source
   * @param {T} [options.metadata] Song metadata
   */
  constructor(
    info: ytdl.videoInfo | SearchResult | OtherSongInfo | ytdl.relatedVideo | RelatedSong,
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
     * The source of the song
     * @type {string}
     */
    this.source = ((info as OtherSongInfo)?.src || source).toLowerCase();
    /**
     * Optional metadata that can be used to identify the song.
     * @type {T}
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
       * Stream formats (Available if the song is from YouTube and playing)
       * @type {ytdl.videoFormat[]?}
       * @private
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
     * YouTube video id
     * @type {string?}
     */
    this.id = details.videoId || details.id;
    /**
     * Song name.
     * @type {string?}
     */
    this.name = details.title || details.name;
    /**
     * Indicates if the video is an active live.
     * @type {boolean}
     */
    this.isLive = !!details.isLive;
    /**
     * Song duration.
     * @type {number}
     */
    this.duration = this.isLive ? 0 : toSecond(details.lengthSeconds || details.length_seconds || details.duration);
    /**
     * Formatted duration string (`hh:mm:ss`, `mm:ss` or `Live`).
     * @type {string?}
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    /**
     * Song URL.
     * @type {string}
     */
    this.url = `https://www.youtube.com/watch?v=${this.id}`;
    /**
     * Stream / Download URL (Available if the song is playing)
     * @type {string?}
     */
    this.streamURL = undefined;
    /**
     * Song thumbnail.
     * @type {string?}
     */
    this.thumbnail =
      details.thumbnails?.sort((a: any, b: any) => b.width - a.width)?.[0]?.url ||
      details.thumbnail?.url ||
      details.thumbnail;
    /**
     * Related songs (without {@link Song#related} properties)
     * @type {Song[]}
     */
    this.related = info?.related_videos || details.related || [];
    if (!Array.isArray(this.related)) throw new DisTubeError("INVALID_TYPE", "Array", this.related, "Song#related");
    this.related = this.related.map((v: any) => new Song(v, { source: this.source, metadata: this.metadata }));
    /**
     * Song views count
     * @type {number}
     */
    this.views = parseNumber(details.viewCount || details.view_count || details.views);
    /**
     * Song like count
     * @type {number}
     */
    this.likes = parseNumber(details.likes);
    /**
     * Song dislike count
     * @type {number}
     */
    this.dislikes = parseNumber(details.dislikes);
    /**
     * Song uploader
     * @type {Object}
     * @prop {string?} name Uploader name
     * @prop {string?} url Uploader url
     */
    this.uploader = {
      name: info.uploader?.name || details.author?.name,
      url: info.uploader?.url || details.author?.channel_url || details.author?.url,
    };
    /**
     * Whether or not an age-restricted content
     * @type {boolean}
     */
    this.age_restricted = !!details.age_restricted;
    /**
     * @typedef {Object} Chapter
     * @prop {string} title Chapter title
     * @prop {number} start_time Chapter start time in seconds
     */
    /**
     * Chapters information (YouTube only)
     * @type {Chapter[]}
     */
    this.chapters = details.chapters || [];
    /**
     * Song repost count
     * @type {number}
     */
    this.reposts = 0;
  }

  /**
   * Patch data from other source
   * @param {OtherSongInfo} info Video info
   * @private
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
    this.age_restricted = info.age_restricted || (!!info.age_limit && parseNumber(info.age_limit) >= 18);
    this.chapters = info.chapters || [];
  }

  /**
   * The playlist added this song
   * @type {Playlist?}
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
   * User requested.
   * @type {Discord.GuildMember?}
   */
  get member() {
    return this.#member;
  }

  set member(member: GuildMember | undefined) {
    if (isMemberInstance(member)) this.#member = member;
  }

  /**
   * User requested.
   * @type {Discord.User?}
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
