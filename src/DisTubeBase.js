// eslint-disable-next-line no-unused-vars
const DisTube = require("./DisTube");

/** @ignore*/
module.exports = class DisTubeBase {
  /** @param {DisTube} distube distube */
  constructor(distube) {
    this.distube = distube;
    this.handler = distube.handler;
    this.options = this.distube.options;
    this.client = this.distube.client;
  }
  emit(...args) {
    this.distube.emit(...args);
  }
};
