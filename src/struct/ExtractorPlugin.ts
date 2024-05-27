import { Plugin } from ".";
import { PluginType } from "..";
import type { GuildMember } from "discord.js";
import type { Awaitable, Playlist, Song } from "..";

/**
 * This plugin can extract the info, search, and play a song directly from its source
 */
export abstract class ExtractorPlugin extends Plugin {
  readonly type = PluginType.EXTRACTOR;
  /**
   * Check if the url is working with this plugin
   * @param url - Input url
   */
  abstract validate(url: string): Awaitable<boolean>;
  /**
   * Resolve the validated url to a {@link Song} or a {@link Playlist}.
   * @param url     - URL
   * @param options - Optional options
   */
  abstract resolve<T>(url: string, options: { member?: GuildMember; metadata?: T }): Awaitable<Song<T> | Playlist<T>>;
  /**
   * Search for a Song which playable from this plugin's source
   * @param query   - Search query
   * @param options - Optional options
   */
  abstract searchSong<T>(query: string, options: { member?: GuildMember; metadata?: T }): Awaitable<Song<T> | null>;
  /**
   * Get the stream url from {@link Song#url}. Returns {@link Song#url} by default.
   * Not needed if the plugin plays song from YouTube.
   * @param song - Input song
   */
  abstract getStreamURL<T>(song: Song<T>): Awaitable<string>;
}
