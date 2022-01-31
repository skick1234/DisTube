import { Plugin } from ".";
import { PluginType } from "..";
import type { CustomPluginPlayOptions } from "..";
import type { VoiceBasedChannel } from "discord.js";

// TODO: Clean parameters on the next major version.

/**
 * Custom Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class CustomPlugin extends Plugin {
  /**
   * @typedef {Object} CustomPluginPlayOptions
   * @param {Discord.GuildMember} [member] Requested user
   * @param {Discord.BaseGuildTextChannel} [textChannel] Default {@link Queue#textChannel}
   * @param {boolean} [skip=false]
   * Skip the playing song (if exists) and play the added song/playlist if `position` is 1.
   * If `position` is defined and not equal to 1, it will skip to the next song instead of the added song
   * @param {number} [position=0] Position of the song/playlist to add to the queue,
   * <= 0 to add to the end of the queue.
   * @param {boolean} [unshift=false] (DEPRECATED) Add the song/playlist to the beginning of the queue
   * (after the playing song if exists)
   * @param {*} [metadata] Metadata
   */
  /**
   * This method will be executed if the url is validated.
   * @param {Discord.BaseGuildVoiceChannel} voiceChannel The voice channel will be joined
   * @param {string} song Validated url
   * @param {CustomPluginPlayOptions} [options] Optional options
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
   * @param {CustomPluginPlayOptions} [options] Optional options
   * @returns {Promise<void>}
   * @abstract
   */
  abstract play(voiceChannel: VoiceBasedChannel, song: string, options: CustomPluginPlayOptions): Promise<void>;
}
