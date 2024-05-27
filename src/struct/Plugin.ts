import type { Awaitable, DisTube, PluginType, Song } from "..";

/**
 * DisTube Plugin
 */
export abstract class Plugin {
  /**
   * Type of the plugin
   */
  abstract readonly type: PluginType;
  /**
   * DisTube
   */
  distube!: DisTube;
  init(distube: DisTube) {
    this.distube = distube;
  }
  /**
   * Get related songs from a supported url.
   * @param song - Input song
   */
  abstract getRelatedSongs(song: Song): Awaitable<Song[]>;
}
