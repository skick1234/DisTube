/* eslint-disable */
const DisTube = require("../DisTube");
const Song = require("./Song");

/**
 * DisTube Plugin
 * @private
 */
class Plugin {
  constructor(type) {
    /**
     * Type of plugin (`"custom"` | `"extractor"`)
     * @type {string}
     */
    this.type = type;
  }
  init(distube) {
    /**
     * DisTube
     * @type {DisTube}
     */
    this.distube = distube;
    /**
     * Handler
     * @type {DisTubeHandler}
     */
    this.handler = this.distube.handler;
  }
  /**
   * Check if the url is working with this plugin
   * @param {string} url Input url
   * @returns {Promise<boolean>}
   */
  async validate(url) { return false }
  /**
   * Get the stream url from {@link Song#url}. Returns {@link Song#url} by default. Not needed if the plugin plays song from YouTube.
   * @param {string} url Input url
   * @returns {Promise<string>}
   */
  async getStreamURL(url) { return url }
  /**
   * (Optional) Get related songs from a supported url (Not needed to add {@link Song#related} and member is `null` because it will be added with this function later)
   * @param {string} url Input url
   * @returns {Promise<Song[]>}
   */
  async getRelatedSongs(url) { return [] }
}

module.exports = Plugin;
