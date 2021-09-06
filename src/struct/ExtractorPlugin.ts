import Plugin from "./Plugin";
import type { Playlist, Song } from ".";
import type { GuildMember } from "discord.js";

/**
 * Extractor Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class ExtractorPlugin extends Plugin {
  type = "extractor" as const;
  /**
   * Resolve the validated url to a {@link Song} or a {@link Playlist}.\
   * Not needed to add {@link Song#related} because it will be added with {@link Plugin#getRelatedSongs}.
   */
  abstract resolve(url: string, member: GuildMember): Promise<Song | Playlist>;
}

/**
 * Resolve the validated url to a {@link Song} or a {@link Playlist}.\
 * Not needed to add {@link Song#related} because it will be added with {@link Plugin#getRelatedSongs}.
 * @param {string} url URL
 * @param {Discord.GuildMember} member Requested user
 * @returns {Promise<Song|Song[]|Playlist>}
 * @method resolve
 * @memberof ExtractorPlugin#
 * @abstract
 */

export default ExtractorPlugin;
