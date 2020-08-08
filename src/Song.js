/* eslint no-unused-vars: "off" */

const duration = require("./duration"),
  Discord = require("discord.js"),
  ytdl = require("ytdl-core");

/** Class representing a song. */
class Song {
  /**
   * Create a song.
   * @param {(ytdl.videoInfo|ytpl_item)} video Youtube video info
   * @param {Discord.User} user Requested user
   */
  constructor(video, user) {
    /**
     * User requested
     * @type {Discord.User}
     */
    this.user = user;
    /**
     * `@2.1.4` Youtube video id
     * @type {string}
     */
    this.id = video.videoDetails ? video.videoDetails.videoId : video.id;
    /**
     * Song name aka video title.
     * @type {string}
     */
    this.name = video.videoDetails ? video.videoDetails.title : video.title;
    /**
     * Song duration.
     * @type {number}
     */
    this.duration = video.duration || parseInt(video.videoDetails.lengthSeconds, 10) || 0;
    /**
     * Formatted duration string `hh:mm:ss`.
     * @type {string}
     */
    this.formattedDuration = duration(this.duration * 1000);
    /**
     * Video URL.
     * @type {string}
     */
    this.url = "https://www.youtube.com/watch?v=" + this.id;
    /**
     * Video thumbnail.
     * @type {string}
     */
    this.thumbnail = video.videoDetails ? video.videoDetails.thumbnail.thumbnails[video.videoDetails.thumbnail.thumbnails.length - 1].url : video.thumbnail;
    /**
     * Related videos (for autoplay mode) 
     * @type {ytdl.relatedVideo[]}
     */
    this.related = video.related_videos;
  }
}

module.exports = Song;