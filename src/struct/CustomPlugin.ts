import { Plugin } from ".";
import { PluginType } from "..";
import type { VoiceBasedChannel } from "discord.js";
import type { Awaitable, PlayOptions } from "..";

/**
 * Custom Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class CustomPlugin extends Plugin {
  readonly type = PluginType.CUSTOM;
  abstract play(voiceChannel: VoiceBasedChannel, song: string, options: PlayOptions): Awaitable<void>;
}

/**
 * This method will be executed if the url is validated.
 * @param {Discord.BaseGuildVoiceChannel} voiceChannel The voice channel will be joined
 * @param {string} song Validated `song`
 * @param {PlayOptions} [options] Optional options
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
