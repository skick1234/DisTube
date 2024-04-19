import { Plugin } from ".";
import { PluginType } from "..";
import type { GuildMember } from "discord.js";
import type { Awaitable, Playlist, Song } from "..";

/**
 * Extractor Plugin
 *
 * @virtual
 */
export abstract class ExtractorPlugin extends Plugin {
  readonly type = PluginType.EXTRACTOR;
  abstract resolve<T = unknown>(
    url: string,
    options: { member?: GuildMember; metadata?: T },
  ): Awaitable<Song<T> | Playlist<T>>;
}

/**
 * Resolve the validated url to a {@link Song} or a {@link Playlist}.
 *
 * @virtual
 *
 * @param url              - URL
 * @param options          - Optional options
 * @param options.member   - Requested user
 * @param options.metadata - Metadata
 */

/**
 * Check if the url is working with this plugin
 *
 * @param url - Input url
 */
