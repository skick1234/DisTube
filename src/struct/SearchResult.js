const { toSecond, formatDuration } = require("./Util");

/** Class representing a search result. */
class SearchResult {
  /**
   * Create a search result
   * @param {Object} info ytsr result
   */
  constructor(info) {
    this.source = "youtube";
    /**
     * Type of SearchResult (`video` or `playlist`)
     * @type {string}
     */
    this.type = info.type;
    /**
     * YouTube video or playlist id
     * @type {string}
     */
    this.id = info.id;
    /**
     * Video or playlist title.
     * @type {string}
     */
    this.name = info.name;
    /**
     * Video or playlist URL.
     * @type {string}
     */
    this.url = info.url;
    /**
     * Video or playlist views count
     * @type {number}
     */
    this.views = info.views;
    if (this.type === "video") {
      /**
       * [Video only] Indicates if the video is an active live.
       * @type {boolean?}
       */
      this.isLive = info.isLive;
      /**
       * [Video only] Video duration.
       * @type {number}
       */
      this.duration = this.isLive ? 0 : toSecond(info.duration);
      /**
       * [Video only] Formatted duration string `hh:mm:ss` or `mm:ss`.
       * @type {string}
       */
      this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
      /**
       * [Video only] Video thumbnail.
       * @type {string?}
       */
      this.thumbnail = info.thumbnail;
    } else if (this.type !== "playlist") throw new TypeError("Unsupported info");
    /**
     * Video or playlist uploader
     * @type {Object}
     * @prop {string?} name Uploader name
     * @prop {string?} url Uploader url
     */
    this.uploader = {
      name: (info.author || info.owner)?.name || null,
      url: (info.author || info.owner)?.url || null,
    };
  }
}

module.exports = SearchResult;
