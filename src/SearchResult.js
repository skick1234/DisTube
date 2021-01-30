/* eslint no-unused-vars: "off" */
const { toSecond } = require("./util"),
  ytsr = require("@distube/ytsr");

/** `@2.7.0` Class representing a search result. */
class SearchResult {
  /**
   * Create a search result.
   * @param {ytsr.Video|ytsr} info Video info
   */
  constructor(info) {
    /**
     * Type of SearchResult (video or playlist)
     * @type {string}
     */
    this.type = info.type;
    /**
     * Youtube video or playlist id
     * @type {string}
     */
    this.id = info.id;
    /**
     * Video or playlist  title.
     * @type {string}
     */
    this.name = info.name;
    /**
     * Video or playlist URL.
     * @type {string}
     */
    this.url = info.url;
    if (this.type === "video") {
      /**
       * Video duration.
       * @type {number}
       */
      this.duration = toSecond(info.duration) || 0;
      /**
       * Formatted duration string `hh:mm:ss` or `mm:ss`.
       * @type {string}
       */
      this.formattedDuration = info.duration;
      /**
       * Video thumbnail.
       * @type {string}
       */
      this.thumbnail = info.thumbnail;
      /**
       * Indicates if the video is an active live.
       * @type {boolean}
       */
      this.isLive = info.isLive;
      /**
       * Video views count
       * @type {number}
       */
      this.views = info.views;
    } else if (this.type === "playlist") {
      /**
       * Playlist length
       * @type {number}
       */
      this.views = info.views;
    } else throw new TypeError("Unsupported info");
  }
}

module.exports = SearchResult;
