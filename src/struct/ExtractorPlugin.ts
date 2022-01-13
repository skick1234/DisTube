import { Plugin } from ".";
import { PluginType } from "..";
import type { Playlist, Song } from ".";
import type { GuildMember } from "discord.js";

/**
 * Extractor Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class ExtractorPlugin extends Plugin {
  /**
   * Resolve the validated url to a {@link Song} or a {@link Playlist}.
   *
   * @param {string} url URL
   * @param {Object} [options] Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {*} [options.metadata] Metadata
   * @returns {Promise<Song|Playlist>}
   * @method resolve
   * @memberof ExtractorPlugin#
   * @abstract
   */
  type = PluginType.EXTRACTOR;
  /**
   * Resolve the validated url to a {@link Song} or a {@link Playlist}.
   *
   * @param {string} url URL
   * @param {Object} [options] Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {*} [options.metadata] Metadata
   * @returns {Promise<Song|Playlist>}
   * @abstract
   */
  abstract resolve<T = unknown>(
    url: string,
    options: { member?: GuildMember; metadata?: T },
  ): Promise<Song<T> | Playlist<T>>;
}
