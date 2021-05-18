/* eslint-disable */
const DisTube = require("../DisTube");

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
}

module.exports = Plugin;
