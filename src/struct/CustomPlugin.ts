import { Plugin } from ".";
import { PluginType } from "..";
import type { Awaitable } from "..";
import type { GuildMember, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";

/**
 * Custom Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class CustomPlugin extends Plugin {
  /**
   * This method will be executed if the url is validated.
   * @param {Discord.BaseGuildVoiceChannel} voiceChannel The voice channel will be joined
   * @param {string} song Validated url
   * @param {Object} [options] Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {Discord.BaseGuildTextChannel} [options.textChannel] Default {@link Queue#textChannel}
   * @param {boolean} [options.skip] Skip the playing song (if exists) and play the added song/playlist instantly
   * @param {boolean} [options.unshift] Add the song/playlist after the playing song if exists
   * @param {*} [options.metadata] Metadata
   * @returns {Promise<void>}
   * @abstract
   * @method play
   * @memberof CustomPlugin#
   */
  type = PluginType.CUSTOM;
  /**
   * This method will be executed if the url is validated.
   * @param {Discord.BaseGuildVoiceChannel} voiceChannel The voice channel will be joined
   * @param {string} song Validated url
   * @param {Object} options Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {Discord.BaseGuildTextChannel} [options.textChannel] Default {@link Queue#textChannel}
   * @param {boolean} [options.skip] Skip the playing song (if exists) and play the added song/playlist instantly
   * @param {boolean} [options.unshift] Add the song/playlist after the playing song if exists
   * @param {*} [options.metadata] Metadata
   * @returns {*}
   * @abstract
   */
  abstract play(
    voiceChannel: VoiceBasedChannel,
    song: string,
    options: {
      skip?: boolean;
      unshift?: boolean;
      member?: GuildMember;
      textChannel?: GuildTextBasedChannel;
      metadata?: any;
    },
  ): Awaitable;
}
