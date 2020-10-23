/* eslint no-unused-vars: "off" */
const { formatDuration, toSecond } = require("./duration"),
  Discord = require("discord.js"),
  ytdl = require("ytdl-core");

const deprecate = (obj, oldProp, value, newProp = null) => {
  Object.defineProperty(obj, oldProp, {
    get: () => {
      if (newProp)
        console.warn(`\`song.${oldProp}\` will be removed in the next major release, use \`song.${newProp}\` instead.`);
      else
        console.warn(`\`song.${oldProp}\` will be removed completely in the next major release.`)
      return value;
    },
  });
};

const deprecateProps = {
  "title": "name",
  "link": "url"
};
/** Class representing a song. */
class Song {
  /**
   * Create a song.
   * @param {ytdl.videoInfo|object} info Video info
   * @param {Discord.User} user Requested user
   * @param {boolean} [youtube=false] Weather or not the video is a Youtube video.
   */
  constructor(info, user, youtube = false) {
    /**
     * `@2.6.0` Weather or not the video is a Youtube video.
     * @type {boolean}
     */
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
      /**
       * `@2.6.0` Stream / Download URL. (Not available with YouTube video)
       * @type {?string}
       */
      this.streamURL = info.url
    );
    /**
     * Song thumbnail.
     * @type {string}
     */
    this.thumbnail = info.videoDetails ? info.videoDetails.thumbnail.thumbnails.sort((a, b) => b.width - a.width)[0].url : info.thumbnail;
    /**
     * Related videos (Only available with YouTube video) 
     * @type {?ytdl.relatedVideo[]}
     */
    this.related = info.related_videos;
    /**
     * `@2.5.0` Indicates if the video is an active live.
     * @type {boolean}
     */
    this.isLive = info.videoDetails ? info.videoDetails.isLive : info.is_live || info.live;
    /**
     * `@2.6.0` Song play count
     * @type {?number}
     */
    this.plays = info.videoDetails ? info.videoDetails.viewCount : info.view_count || 0;
    /**
     * `@2.6.0` Song like count
     * @type {?number}
     */
    this.likes = info.videoDetails ? info.videoDetails.likes : info.like_count || 0;
    /**
     * `@2.6.0` Song dislike count
     * @type {?number}
     */
    this.dislikes = info.videoDetails ? info.videoDetails.dislikes : info.dislike_count || 0;
    /**
     * `@2.6.0` Song repost count
     * @type {?number}
     */
    this.reposts = info.repost_count || 0;

    /**
     * @deprecated use `Song.name` instead 
     * @type {string}
     */
    this.title = "";
    /**
     * @deprecated use `Song.url` instead
     * @type {string}
     */
    this.link = "";
    for (let [oldProp, newProp] of Object.entries(deprecateProps))
      deprecate(this, oldProp, this[newProp], newProp);
  }
}

module.exports = Song;