/* eslint-disable complexity */
/* eslint no-unused-vars: "off" */
const { formatDuration, toSecond, parseNumber } = require("./util"),
  Discord = require("discord.js"),
  ytdl = require("ytdl-core");

/** Class representing a song. */
class Song {
  /**
   * Create a song.
   * @param {ytdl.videoInfo|Object} info Video info
   * @param {Discord.User} user Requested user
   * @param {boolean} [youtube=false] Weather or not the video is a Youtube video.
   */
  constructor(info, user, youtube = false) {
    /**
     * `@2.6.0` Weather or not the video is a Youtube video.
     * @type {boolean}
     */
    this.youtube = info.youtube || youtube;
    if (this.youtube && info.full) {
      this.info = info;
      info = info.videoDetails;
    }
    /**
     * User requested
     * @type {Discord.User}
     */
    this.user = user;
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
    this.duration = toSecond(Number(info.lengthSeconds) || info._duration_raw || info.duration) || 0;
    /**
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
     * @type {string}
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration * 1000)
    /**
     * Song URL.
     * @type {string}
     */
    this.url = this.youtube ? `https://www.youtube.com/watch?v=${this.id}` : info.webpage_url;
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
     */
    /**
     */
  }
}

module.exports = Song;
