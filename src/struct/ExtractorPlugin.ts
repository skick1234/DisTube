/* eslint-disable @typescript-eslint/no-unused-vars */
import { Plugin } from ".";
import { PluginType } from "..";
import type { GuildMember } from "discord.js";
import type { Awaitable, Playlist, Song } from "..";

/**
 * Extractor Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class ExtractorPlugin extends Plugin {
  type = PluginType.EXTRACTOR;
  /**
   * Resolve the validated url to a {@link Song} or a {@link Playlist}.
   *
   * @param {string} url URL
   * @param {Object} [options] Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {*} [options.metadata] Metadata
   * @returns {Song|Playlist|Promise<Song|Playlist>}
   * @abstract
   */
  abstract resolve<T = unknown>(
    url: string,
    options: { member?: GuildMember; metadata?: T },
  ): Awaitable<Song<T> | Playlist<T>>;
  /**
   * Check if the url is working with this plugin
   * @param {string} url Input url
   * @returns {boolean|Promise<boolean>}
   */
  validate(url: string): Awaitable<boolean> {
    return false;
  }
}

/**
 * Resolve the validated url to a {@link Song} or a {@link Playlist}.
 *
 * @param {string} url URL
 * @param {Object} [options] Optional options
 * @param {Discord.GuildMember} [options.member] Requested user
 * @param {*} [options.metadata] Metadata
 * @returns {Song|Playlist|Promise<Song|Playlist>}
 * @method resolve
 * @memberof ExtractorPlugin#
 * @abstract
 */
