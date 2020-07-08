const duration = require("./duration");

/**
 * Represents a song.
 * @param {ytdl.videoInfo} video Youtube video info
 * @param {Snowflake} userID The ID of the user requested video
 */
class Song {
  constructor(video, user) {
    /**
     * User requested
     * @type {Discord.User}
     */
    this.user = user;
    /**
     * Song name aka video title.
     * @type {string}
     */
    this.name = video.videoDetails ? video.videoDetails.title : video.title;
    /**
     * Song duration.
     * @type {number}
     */
    this.duration = video.duration || parseInt(video.videoDetails.lengthSeconds);
    /**
     * Formatted duration string `hh:mm:ss`.
     * @type {string}
     */
    this.formattedDuration = duration(this.duration * 1000);
    /**
     * Video URL.
     * @type {string}
     */
    this.url = video.url || video.videoDetails.video_url || "https://www.youtube.com/watch?v=" + video.id;
    /**
     * Video thumbnail.
     * @type {string}
     */
    this.thumbnail = video.thumbnail || video.video_thumbnail || video.videoDetails.thumbnail.thumbnails[video.videoDetails.thumbnail.thumbnails.length - 1].url;
    /**
     * Related videos (for autoplay mode) 
     * @type {ytdl.relatedVideo[]}
     */
    this.related = video.related_videos;
  }
}

module.exports = Song;