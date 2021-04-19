/* eslint-disable */
const Plugin = require("./Plugin");
const Discord = require("discord.js");

/**
 * Extractor Plugin
 * @extends Plugin
 */
class ExtractorPlugin extends Plugin {
  /** Create a extractor plugin */
  constructor() {
    super("extractor");
  }
  /**
   * Execute if the url is validated
   * @param {string} url URL
   * @param {Discord.GuildMember} member Requested user
   * @returns {Promise<void>}
   */
  async resolve(url, member) { }
}

module.exports = ExtractorPlugin;
