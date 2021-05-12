const { toSecond, formatDuration } = require("./util");

/** Class representing a search result. */
class SearchResult {
  constructor(info) {
    this.source = "youtube";
    /**
     * Type of SearchResult (video or playlist)
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
     * Video / Playlist views count
     * @type {number}
     */
    this.views = info.views;
    if (this.type === "video") {
      /**
       * Indicates if the video is an active live.
       * @type {boolean?}
       */
      this.isLive = info.isLive;
      /**
       * Video duration.
       * @type {number}
       */
      this.duration = this.isLive ? 0 : toSecond(info.duration);
      /**
       * Formatted duration string `hh:mm:ss` or `mm:ss`.
       * @type {string}
       */
      this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
      /**
       * Video thumbnail.
       * @type {string?}
       */
      this.thumbnail = info.thumbnail;
    } else if (this.type !== "playlist") throw new TypeError("Unsupported info");
    /**
     * Video/Playlist uploader
     * @type {Object}
     * @prop {string?} name Uploader name
     * @prop {string?} url Uploader url
     */
    this.uploader = {
      name: (info.author || info.owner).name || null,
      url: (info.author || info.owner).url || null,
    };
  }
}

module.exports = SearchResult;
