const { formatDuration, toSecond, parseNumber } = require("./util"),
  Playlist = require("./Playlist"),
  ytdl = require("ytdl-core"),
  SearchResult = require("./SearchResult"),
  Discord = require("discord.js");

/** Class representing a song. */
class Song {
  /**
   * Create a Song
   * @param {ytdl.videoInfo|SearchResult|Object} info Raw info
   * @param {Discord.GuildMember} member Requested user
   * @param {string} src Song source
   */
  constructor(info, member = null, src = "youtube") {
    if (typeof src !== "string") throw new TypeError("Source must be a string");
    /**
     * The source of the song
     * @type {string}
     */
    this.source = src.toLowerCase();
    this._patchMember(member);
    if (this.source === "youtube") this._patchYouTube(info);
    else this._patchOther(info);
  }

  /**
   * Patch data from ytdl-core
   * @param {ytdl.videoInfo|SearchResult} info Video info
   * @private
   */
  _patchYouTube(info) {
    if (info.full) {
      /**
       * `ytdl-core` raw info (If the song is playing)
       * @type {ytdl.videoInfo?}
       * @private
       */
      this.info = info;
      const err = require("ytdl-core/lib/utils").playError(info.player_response, ["UNPLAYABLE", "LIVE_STREAM_OFFLINE", "LOGIN_REQUIRED"]);
      if (err) throw err;
      if (!info.formats?.length) throw new Error("This video is unavailable");
    }
    const details = info.videoDetails || info;
    /**
     * YouTube video id
     * @type {string}
     */
    this.id = details.videoId || details.id;
    /**
     * Song name aka video title.
     * @type {string}
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
     * @type {string}
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    /**
     * Song URL.
     * @type {string}
     */
    this.url = `https://www.youtube.com/watch?v=${this.id}`;
    /**
     * Stream / Download URL.
     * @type {string?}
     */
    this.streamURL = this.info?.formats?.length ? ytdl.chooseFormat(this.info.formats, {
      filter: this.isLive ? "audioandvideo" : "audioonly",
      quality: "highestaudio",
    }).url : null;
    /**
     * Song thumbnail.
     * @type {string?}
     */
    this.thumbnail = details.thumbnails?.sort((a, b) => b.width - a.width)[0].url ||
      details.thumbnail?.url || details.thumbnail || null;
    /**
     * Related songs
     * @type {Array<Song>}
     */
    this.related = this.info?.related_videos.map(v => new Song(v)) || [];
    /**
     * Song views count
     * @type {number}
     */
    this.views = parseNumber(details.viewCount || details.view_count);
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
      name: info.uploader?.name || details.author?.name || null,
      url: info.uploader?.url || details.author?.channel_url || details.author?.url || null,
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
    this.chapters = info.chapters || [];
  }

  /**
   * Patch data from other source
   * @param {Object} info Video info
   * @private
   */
  _patchOther(info) {
    this.id = info.id;
    this.name = info.title || info.name;
    this.isLive = Boolean(info.is_live || info.isLive);
    this.duration = this.isLive ? 0 : toSecond(info._duration_raw || info.duration);
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    this.url = info.webpage_url || info.url;
    this.streamURL = null;
    this.thumbnail = info.thumbnail?.url || info.thumbnail || null;
    this.related = info.related || [];
    this.views = parseNumber(info.view_count || info.views);
    this.likes = parseNumber(info.like_count || info.likes);
    this.dislikes = parseNumber(info.dislike_count || info.dislikes);
    /**
     * Song repost count
     * @type {number}
     */
    this.reposts = parseNumber(info.repost_count || info.reposts);
    this.uploader = {
      name: info.uploader || null,
      url: info.uploader_url || null,
    };
    this.age_restricted = !!info.age_limit && parseNumber(info.age_limit) >= 18;
    this.chapters = info.chapters || [];
  }

  /**
   * @param {Playlist} playlist Playlist
   * @param {Discord.GuildMember} [member] Requested user
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
    return this._patchMember(member);
  }

  /**
   * @param {Discord.GuildMember} [member] Requested user
   * @private
   * @returns {Song}
   */
  _patchMember(member = this.member) {
    /**
     * User requested
     * @type {Discord.GuildMember?}
     */
    this.member = member;
    /**
     * User requested
     * @type {Discord.User?}
     */
    this.user = member?.user;
    return this;
  }
}

module.exports = Song;
