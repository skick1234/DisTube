/* eslint no-unused-vars: "off" */
const { toSecond } = require("./util"),
  ytsr = require("@distube/ytsr");

/** `@2.7.0` Class representing a search result. */
class SearchResult {
  /**
   * Create a search result.
   * @param {ytsr.Video} info Video info
   */
  constructor(info) {
    /**
     * Youtube video id
     * @type {string}
     */
    this.id = info.id;
    /**
     * Song name aka video title.
     * @type {string}
     */
    this.name = info.name;
    /**
     * Song duration.
     * @type {number}
     */
    this.duration = toSecond(info.duration) || 0;
    /**
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
     * @type {string}
     */
    this.formattedDuration = info.duration;
    /**
     * Song URL.
     * @type {string}
     */
    this.url = info.url;
    /**
     * Song thumbnail.
     * @type {string}
     */
    this.thumbnail = info.thumbnail;
    /**
     * Indicates if the video is an active live.
     * @type {boolean}
     */
    this.isLive = info.isLive;
    /**
     * Song views count
     * @type {number}
     */
    this.views = info.views;
  }
}

module.exports = SearchResult;
