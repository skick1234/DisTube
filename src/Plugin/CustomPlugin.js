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
   * @param {Discord.VoiceChannel|Discord.StageChannel} voiceChannel The voice channel will be joined
   * @param {string} url Validated url
   * @param {Discord.GuildMember} member Requested user
   * @param {Discord.TextChannel?} textChannel Default {@link Queue#textChannel}
   * @param {boolean} skip Skip the playing song (if exists)
   * @returns {Promise<void>}
   */
  async play(voiceChannel, url, member, textChannel, skip) { }
}

module.exports = CustomPlugin;
