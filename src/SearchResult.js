/* eslint no-unused-vars: "off" */
const { toSecond } = require("./duration"),
  ytsr = require("@distube/ytsr");

const deprecate = (obj, oldProp, value, newProp = null) => {
  Object.defineProperty(obj, oldProp, {
    get: () => {
      if (newProp) console.warn(`\`${obj.constructor.name}.${oldProp}\` will be removed in the next major release, use \`${obj.constructor.name}.${newProp}\` instead.`);
      else console.warn(`\`${obj.constructor.name}.${oldProp}\` will be removed completely in the next major release.`)
      return value;
    },
  });
};

const deprecateProps = {
  title: "name",
  link: "url",
};

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
    for (let [oldProp, newProp] of Object.entries(deprecateProps)) deprecate(this, oldProp, this[newProp], newProp);
  }
}

module.exports = SearchResult;
