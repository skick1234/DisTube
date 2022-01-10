import Plugin from "./Plugin";
import { PluginType } from "..";
import type { GuildMember, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";

// TODO: Clean parameters on the next major version.

/**
 * Custom Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class CustomPlugin extends Plugin {
  type = PluginType.CUSTOM;
  /**
   * This method will be executed if the url is validated.
   * @param {Discord.VoiceBasedChannel} voiceChannel The voice channel will be joined
   * @param {string} song Validated url
   * @param {Object} [options] Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {Discord.GuildTextBasedChannel} [options.textChannel] Default {@link Queue#textChannel}
   * @param {boolean} [options.skip] Skip the playing song (if exists) and play the added song/playlist instantly
   * @param {boolean} [options.unshift] Add the song/playlist after the playing song if exists
   * @param {*} [options.metadata] Metadata
   * @returns {Promise<void>}
   * @abstract
   */
  abstract play(
    voiceChannel: VoiceBasedChannel,
    song: string,
    options: {
      skip: boolean;
      unshift: boolean;
      member: GuildMember;
      textChannel?: GuildTextBasedChannel;
      metadata?: any;
    },
  ): Promise<void>;
}

/**
 * This method will be executed if the url is validated.
 * @param {Discord.VoiceBasedChannel} voiceChannel The voice channel will be joined
 * @param {string} song Validated url
 * @param {Object} [options] Optional options
 * @param {Discord.GuildMember} [options.member] Requested user
 * @param {Discord.GuildTextBasedChannel} [options.textChannel] Default {@link Queue#textChannel}
 * @param {boolean} [options.skip] Skip the playing song (if exists) and play the added song/playlist instantly
 * @param {boolean} [options.unshift] Add the song/playlist after the playing song if exists
 * @param {*} [options.metadata] Metadata
 * @returns {Promise<void>}
 * @abstract
 * @method play
 * @memberof CustomPlugin#
 */

export default CustomPlugin;
