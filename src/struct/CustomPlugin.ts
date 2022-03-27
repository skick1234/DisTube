import { Plugin } from ".";
import { PluginType } from "..";
import type { VoiceBasedChannel } from "discord.js";
import type { Awaitable, CustomPluginPlayOptions } from "..";

/**
 * Custom Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class CustomPlugin extends Plugin {
  readonly type = PluginType.CUSTOM;
  abstract play(voiceChannel: VoiceBasedChannel, song: string, options: CustomPluginPlayOptions): Awaitable<void>;
}

/**
 * @typedef {Object} CustomPluginPlayOptions
 * @param {Discord.GuildMember} [member] Requested user
 * @param {Discord.BaseGuildTextChannel} [textChannel] Default {@link Queue#textChannel}
 * @param {boolean} [skip=false]
 * Skip the playing song (if exists) and play the added song/playlist if `position` is 1.
 * If `position` is defined and not equal to 1, it will skip to the next song instead of the added song
 * @param {number} [position=0] Position of the song/playlist to add to the queue,
 * <= 0 to add to the end of the queue.
 * @param {*} [metadata] Optional metadata that can be attached to the song/playlist will be played.
 */

/**
 * This method will be executed if the url is validated.
 * @param {Discord.BaseGuildVoiceChannel} voiceChannel The voice channel will be joined
 * @param {string} song Validated `song`
 * @param {CustomPluginPlayOptions} [options] Optional options
 * @returns {Promise<void>}
 * @abstract
 * @method play
 * @memberof CustomPlugin#
 */

/**
 * Check if the string is working with this plugin
 * @param {string} string String need to validate
 * @returns {boolean|Promise<boolean>}
 * @method validate
 * @memberof CustomPlugin#
 */
