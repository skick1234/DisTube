// eslint-disable-next-line no-unused-vars
const DisTube = require("./DisTube");
// eslint-disable-next-line no-unused-vars
const Discord = require("discord.js");

/** @private */
class DisTubeBase {
  constructor(distube) {
    /**
     * DisTube
     * @type {DisTube}
     * @private
     */
    this.distube = distube;
    /**
     * DisTube options
     * @type {DisTube.DisTubeOptions}
     * @private
     */
    this.options = this.distube.options;
    /**
     * Discord.js client
     * @type {Discord.Client}
     * @private
     */
    this.client = this.distube.client;
  }
  /**
   * Redirect emitter
   * @private
   * @param  {...any} args arguments
   */
  emit(...args) {
    this.distube.emit(...args);
  }
}

module.exports = DisTubeBase;
