const { formatDuration, toSecond, parseNumber } = require("./util"),
  ytdl = require("ytdl-core"),
  Playlist = require("./Playlist"),
  // eslint-disable-next-line no-unused-vars
  Discord = require("discord.js");

/** Class representing a song. */
class Song {
  constructor(info, member = null, src = "youtube") {
    if (typeof src !== "string") throw new TypeError("Source must be a string");
    /**
     * The source of the song
     * @type {string}
     */
    this.source = src;
    /**
     * User requested
     * @type {Discord.GuildMember?}
     */
    this.member = member;
    /**
     * User requested
     * @type {Discord.User?}
     */
    this.user = this.member?.user;
    if (this.source === "youtube" && info.full) {
      /**
       * `ytdl-core` raw info (If the song is from YouTube)
       * @type {ytdl.videoInfo?}
       * @private
       */
      this.info = info;
      info = info.videoDetails;
    }
    this._patch(info);
  }

  /**
   * Patch data
   * @param {ytdl.MoreVideoDetails} info Video info
   * @private
   */
  _patch(info) {
    /**
     * Youtube video id
     * @type {string}
     */
    this.id = info.videoId || info.id;
    /**
     * Song name aka video title.
     * @type {string}
     */
    this.name = info.title;
    /**
     * Indicates if the video is an active live.
     * @type {boolean}
     */
    this.isLive = info.isLive || info.is_live || false;
    /**
     * Song duration.
     * @type {number}
     */
    this.duration = toSecond(info.lengthSeconds || info._duration_raw || info.duration);
    /**
     * Formatted duration string (`hh:mm:ss`, `mm:ss` or `Live`).
     * @type {string}
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    /**
     * Song URL.
     * @type {string}
     */
    this.url = this.source === "youtube" ? `https://www.youtube.com/watch?v=${this.id}` : info.webpage_url;
    /**
     * Stream / Download URL.
     * @type {string?}
     */
    this.streamURL = this.info && this.info.formats.length ? ytdl.chooseFormat(this.info.formats, {
      filter: this.isLive ? "audioandvideo" : "audioonly",
      quality: "highestaudio",
    }).url : info.url;
    /**
     * Song thumbnail.
     * @type {string?}
     */
    this.thumbnail = info.thumbnails ? info.thumbnails.sort((a, b) => b.width - a.width)[0].url : info.thumbnail || null;
    /**
     * Related videos (Only available with YouTube video)
     * @type {ytdl.relatedVideo[]?}
     */
    this.related = this.info?.related_videos;
    /**
     * Song views count
     * @type {number}
     */
    this.views = parseNumber(info.viewCount || info.view_count || info.views);
    /**
     * Song like count
     * @type {number}
     */
    this.likes = parseNumber(info.likes || info.like_count);
    /**
     * Song dislike count
     * @type {number}
     */
    this.dislikes = parseNumber(info.dislikes || info.dislike_count);
    /**
     * Song repost count
     * @type {number}
     */
    this.reposts = parseNumber(info.repost_count);
    /**
     * Song uploader
     * @type {Object}
     * @prop {string?} name Uploader name
     * @prop {string?} url Uploader url
     */
    this.uploader = {
      name: info.author ? info.author.name : info.uploader || null,
      url: info.author ? info.author.channel_url : info.uploader_url || null,
    };
  }

  /**
   * @param {Playlist} playlist Playlist
   * @param {Discord.GuildMember} member User requested
   * @private
   * @returns {Song}
   */
  _patchPlaylist(playlist, member = this.member) {
    if (!(playlist instanceof Playlist)) throw new TypeError("playlist is not a valid Playlist");
    /**
     * The playlist added this song
     * @type {Playlist?}
     */
    this.playlist = playlist;
    this.member = member;
    return this;
  }
}

module.exports = Song;
