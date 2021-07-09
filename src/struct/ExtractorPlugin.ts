import Plugin from "./Plugin";
import { Playlist, Song } from ".";
import { GuildMember } from "discord.js";

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, require-await
  async resolve(url: string, member: GuildMember): Promise<Song | Playlist> {
    return undefined as unknown as Song;
  }
}

export default ExtractorPlugin;
