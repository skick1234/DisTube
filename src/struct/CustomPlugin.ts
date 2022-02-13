/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin } from ".";
import { PluginType } from "..";
import type { VoiceBasedChannel } from "discord.js";
import type { Awaitable, CustomPluginPlayOptions, Playlist, SearchResult, Song } from "..";

/**
 * Custom Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class CustomPlugin extends Plugin {
  type = PluginType.CUSTOM;
  /**
   * This method will be executed if the `song` string is validated.
   * @param {Discord.BaseGuildVoiceChannel} voiceChannel The voice channel will be joined
   * @param {string} song Validated `song`
   * @param {CustomPluginPlayOptions} [options] Optional options
   * @returns {Promise<void>}
   * @abstract
   */
  abstract play(voiceChannel: VoiceBasedChannel, song: string, options: CustomPluginPlayOptions): Awaitable<void>;
  /**
   * Check if the {@link DisTube#play} `song` parameter is working with this plugin
   * @param {string} song String need to validate
   * @returns {boolean|Promise<boolean>}
   */
  validate(song: string): Awaitable<boolean> {
    return false;
  }
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
