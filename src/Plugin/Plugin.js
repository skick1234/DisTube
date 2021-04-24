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
}

module.exports = Plugin;
