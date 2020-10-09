/* eslint no-unused-vars: "off" */
const { formatDuration, toSecond } = require("./duration"),
  Discord = require("discord.js"),
  ytdl = require("ytdl-core");

/** Class representing a song. */
class Song {
  /**
   * Create a song.
   * @param {(ytdl.videoInfo|ytpl_item)} video Youtube video info
   * @param {Discord.User} user Requested user
   */
  constructor(info, user, youtube = false) {
    this.youtube = info.youtube || youtube;
    /**
     * User requested
     * @type {Discord.User}
     */
    this.user = user;
    /**
     * `@2.1.4` Youtube video id
     * @type {string}
     */
    this.id = info.videoDetails ? info.videoDetails.videoId : info.id;
    /**
     * Song name aka video title.
     * @type {string}
     */
    this.name = info.videoDetails ? info.videoDetails.title : info.title;
    /**
     * Song duration.
     * @type {number}
     */
    this.duration = toSecond(info.videoDetails ? parseInt(info.videoDetails.lengthSeconds, 10) : info._duration_raw || info.duration || 0);
    /**
     * Formatted duration string `hh:mm:ss`.
     * @type {string}
     */
    this.formattedDuration = formatDuration(this.duration * 1000)
    /**
     * Song URL.
     * @type {string}
     */
    this.url = this.youtube ? ("https://www.youtube.com/watch?v=" + this.id) : info.webpage_url;
    !this.youtube && (
      this.streamURL = info.url
    );
    /**
     * Song thumbnail.
     * @type {string}
     */
    this.thumbnail = info.videoDetails ? info.videoDetails.thumbnail.thumbnails[info.videoDetails.thumbnail.thumbnails.length - 1].url : info.thumbnail;
    /**
     * Related videos (for autoplay mode) 
     * @type {ytdl.relatedVideo[]}
     */
    this.related = info.related_videos;
    /**
     * Indicates if the video is an active live.
     * @type {boolean}
     */
    this.isLive = info.videoDetails ? info.videoDetails.isLive : info.is_live || info.live;
    this.plays = info.videoDetails ? info.videoDetails.viewCount : info.view_count || 0;
    this.likes = info.videoDetails ? info.videoDetails.likes : info.like_count || 0;
    this.dislikes = info.videoDetails ? info.videoDetails.dislikes : info.dislike_count || 0;
    this.reposts = info.repost_count || 0;
  }
}

module.exports = Song;