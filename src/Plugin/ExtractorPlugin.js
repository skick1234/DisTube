/* eslint-disable */
const Plugin = require("./Plugin");
const Discord = require("discord.js");
const Song = require("../Song");
const Playlist = require("../Playlist");

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
   * Execute if the url is validated (Not needed to add {@link Song#related} because it will be added with {@link Plugin#getRelatedSongs})
   * @param {string} url URL
   * @param {Discord.GuildMember} member Requested user
   * @returns {Promise<Song|Song[]|Playlist>}
   */
  async resolve(url, member) { }
}

module.exports = ExtractorPlugin;
