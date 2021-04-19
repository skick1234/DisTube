/* eslint-disable */
const Plugin = require("./Plugin"),
  Discord = require("discord.js");

/**
 * Custom Plugin
 * @extends Plugin
*/
class CustomPlugin extends Plugin {
  /** Create a custom plugin */
  constructor() {
    super("custom");
  }
  /**
   * Execute if the url is validated
   * @param {Discord.Message} message Message
   * @param {string} url URL
   * @param {boolean} skip Skip?
   * @returns {Promise<void>}
   */
  async play(message, url, skip) { }
}

module.exports = CustomPlugin;
