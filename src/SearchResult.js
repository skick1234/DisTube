const { toSecond } = require("./util"),
  // eslint-disable-next-line no-unused-vars
  ytsr = require("@distube/ytsr");

/** `@2.7.0` Class representing a search result. */
class SearchResult {
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
       * @type {number?}
       */
      this.duration = toSecond(info.duration);
      /**
       * Formatted duration string `hh:mm:ss` or `mm:ss`.
       * @type {string?}
       */
      this.formattedDuration = info.duration;
      /**
       * Video thumbnail.
       * @type {string?}
       */
      this.thumbnail = info.thumbnail;
      /**
       * Indicates if the video is an active live.
       * @type {boolean?}
       */
      this.isLive = info.isLive;
      /**
       * Video / Playlist views count
       * @type {number}
       */
      this.views = info.views;
    } else if (this.type === "playlist") {
      this.views = info.views;
    } else throw new TypeError("Unsupported info");
  }
}

module.exports = SearchResult;
