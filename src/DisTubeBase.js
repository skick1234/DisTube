// eslint-disable-next-line no-unused-vars
const DisTube = require("./DisTube");
// eslint-disable-next-line no-unused-vars
const Discord = require("discord.js");

/** @private */
class DisTubeBase {
  /** @param {DisTube} distube distube */
  constructor(distube) {
    /** @type {DisTube} */
    this.distube = distube;
    /** @type {DisTube.DisTubeOptions} */
    this.options = this.distube.options;
    /** @type {Discord.Client} */
    this.client = this.distube.client;
  }
  emit(...args) {
    this.distube.emit(...args);
  }
}

module.exports = DisTubeBase;
