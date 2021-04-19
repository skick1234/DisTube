/* eslint-disable */
/**
 * DisTube Plugin
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
    this.distube = distube;
  }
  /**
   * Check if the url is working with this plugin
   * @param {string} url Input url
   * @returns {Promise<boolean>}
   */
  async validate(url) { return false }
}

module.exports = Plugin;
