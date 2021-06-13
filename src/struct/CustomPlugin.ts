/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin } from ".";
import { GuildMember, StageChannel, TextChannel, VoiceChannel } from "discord.js";

/**
 * Custom Plugin
 * @extends Plugin
 */
export class CustomPlugin extends Plugin {
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
   * @param {boolean} skip Skip the playing song (if exists) and play the added song/playlist instantly
   * @param {boolean} unshift Add the song/playlist to the beginning of the queue (after the playing song if exists)
   * @returns {Promise<void>}
   */
  async play(
    voiceChannel: VoiceChannel | StageChannel,
    url: string,
    member: GuildMember,
    textChannel: TextChannel | null,
    skip: boolean,
    unshift: boolean,
  ): Promise<void> {
    // Template
  }
}

export default CustomPlugin;
