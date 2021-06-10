/* eslint-disable @typescript-eslint/no-unused-vars */
import Plugin from "./Plugin";
import Discord from "discord.js";
import Song from "./Song";
import Playlist from "./Playlist";

/**
 * Extractor Plugin
 * @extends Plugin
 */
export class ExtractorPlugin extends Plugin {
  /** Create a extractor plugin */
  constructor() {
    super("extractor");
  }
  /**
   * Execute if the url is validated (Not needed to add {@link Song#related} because it will be added with {@link Plugin#getRelatedSongs})
   * @param {string} url URL
   * @param {Discord.GuildMember} member Requested user
   * @returns {Promise<Song|Song[]|Playlist>}
   */
  // eslint-disable-next-line require-await
  async resolve(
    url: string,
    member: Discord.GuildMember,
  ): Promise<Song | Playlist> {
    return undefined as unknown as Song;
  }
}

export default ExtractorPlugin;
