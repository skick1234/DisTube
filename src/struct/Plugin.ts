/* eslint-disable require-await, @typescript-eslint/no-unused-vars */
import DisTube from "../DisTube";
import { Song } from ".";
import { DisTubeHandler } from "../core";

/**
 * DisTube Plugin
 * @private
 */
export class Plugin {
  /** Type of the plugin */
  type: "custom" | "extractor";
  distube!: DisTube;
  handler!: DisTubeHandler;
  constructor(type: "custom" | "extractor") {
    /**
     * Type of the plugin
     * @type {"custom"|"extractor"}
     */
    this.type = type;
  }
  init(distube: DisTube) {
    /**
     * DisTube
     * @type {DisTube}
     */
    this.distube = distube;
    /**
     * Handler
     * @type {DisTubeHandler}
     */
    this.handler = this.distube.handler;
  }
  /**
   * Check if the url is working with this plugin
   * @param {string} url Input url
   * @returns {Promise<boolean>}
   */
  async validate(url: string): Promise<boolean> { return false }
  /**
   * Get the stream url from {@link Song#url}. Returns {@link Song#url} by default. Not needed if the plugin plays song from YouTube.
   * @param {string} url Input url
   * @returns {Promise<string>}
   */
  async getStreamURL(url: string): Promise<string> { return url }
  /**
   * (Optional) Get related songs from a supported url (Not needed to add {@link Song#related} and member is `null` because it will be added with this function later)
   * @param {string} url Input url
   * @returns {Promise<Song[]>}
   */
  async getRelatedSongs(url: string): Promise<Song[]> { return [] }
}

export default Plugin;
