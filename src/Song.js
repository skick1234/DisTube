/* eslint-disable complexity */
const { formatDuration, toSecond, parseNumber } = require("./util"),
  ytdl = require("ytdl-core"),
  Playlist = require("./Playlist");

/**
 * @typedef {import("discord.js").GuildMember} GuildMember
 * @typedef {import("discord.js").User} User
 */

/** Class representing a song. */
class Song {
  /**
   * Create a song.
   * @param {ytdl.videoInfo|Object} info Video info
   * @param {GuildMember?} member Requested user
   * @param {string} [src="youtube"] Weather or not the video is a Youtube video.
   */
  constructor(info, member = null, src = "youtube") {
    if (typeof src !== "string") throw new TypeError("Source must be a string");
    /**
     * `@3.0.0` The source of the song
     * @type {string}
     */
    this.source = src;
    /**
     * `@3.0.0` User requested
     * @type {GuildMember?}
     */
    this.member = member;
    if (this.source === "youtube" && info.full) {
      /**
       * `@3.0.0` `ytdl-core` raw info (If the song is from YouTube)
       * @type {?ytdl.videoInfo}
       * @private
       */
      this.info = info;
      info = info.videoDetails;
    }
    this._patch(info);
  }

  /**
   * User requested
   * @type {User?}
   */
  get user() {
    return this.member?.user;
  }

  /**
   * Patch data
   * @param {ytdl.MoreVideoDetails} info Video info
   * @private
   * @ignore
   */
  _patch(info) {
    /**
     * `@2.1.4` Youtube video id
     * @type {string}
     */
    this.id = info.videoId || info.id;
    /**
     * Song name aka video title.
     * @type {string}
     */
    this.name = info.title;
    /**
     * `@2.5.0` Indicates if the video is an active live.
     * @type {boolean}
     */
    this.isLive = info.isLive || info.is_live || false;
    /**
     * Song duration.
     * @type {number}
     */
    this.duration = toSecond(info.lengthSeconds || info._duration_raw || info.duration);
    /**
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
     * @type {string}
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration * 1000);
    /**
     * Song URL.
     * @type {string}
     */
    this.url = this.src === "youtube" ? `https://www.youtube.com/watch?v=${this.id}` : info.webpage_url;
    /**
     * `@2.6.0` Stream / Download URL.
     * @type {?string}
     */
    this.streamURL = this.info && this.info.formats.length ? ytdl.chooseFormat(this.info.formats, {
      filter: this.isLive ? "audioandvideo" : "audioonly",
      quality: "highestaudio",
    }).url : info.url;
    /**
     * Song thumbnail.
     * @type {?string}
     */
    this.thumbnail = info.thumbnails ? info.thumbnails.sort((a, b) => b.width - a.width)[0].url : info.thumbnail || null;
    /**
     * Related videos (Only available with YouTube video)
     * @type {?ytdl.relatedVideo[]}
     */
    this.related = info.related_videos;
    /**
     * `@2.6.0` Song views count
     * @type {number}
     */
    this.views = parseNumber(info.viewCount || info.view_count || info.views);
    /**
     * `@2.6.0` Song like count
     * @type {number}
     */
    this.likes = parseNumber(info.likes || info.like_count);
    /**
     * `@2.6.0` Song dislike count
     * @type {number}
     */
    this.dislikes = parseNumber(info.dislikes || info.dislike_count);
    /**
     * `@2.6.0` Song repost count
     * @type {number}
     */
    this.reposts = parseNumber(info.repost_count);
    /**
     * `@3.0.0` Song uploader
     * @type {object}
     * @prop {?string} name Uploader name
     * @prop {?string} url Uploader url
     */
    this.uploader = {
      name: info.author ? info.author.name : info.uploader || null,
      url: info.author ? info.author.channel_url : info.uploader_url || null,
    };
  }

  /**
   * @param {Playlist} playlist Playlist
   * @param {GuildMember} member User requested
   * @ignore
   * @returns {Song}
   */
  _patchPlaylist(playlist, member = this.member) {
    if (!(playlist instanceof Playlist)) throw new TypeError("playlist is not a valid Playlist");
    /**
     * `@3.0.0` The playlist added this song
     * @type {?Playlist}
     */
    this.playlist = playlist;
    this.member = member;
    return this;
  }
}

module.exports = Song;
