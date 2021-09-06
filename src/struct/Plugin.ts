/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import type { Client, TextChannel } from "discord.js";
import type { DisTube, DisTubeEvents, DisTubeHandler, DisTubeVoiceManager, Options, QueueManager, Song } from "..";

/**
 * All available plugin types:
 * * `custom`: {@link CustomPlugin}
 * * `extractor`: {@link ExtractorPlugin}
 * @typedef {"custom"|"extractor"} PluginType
 */

/**
 * DisTube Plugin
 * @abstract
 * @private
 */
export abstract class Plugin {
  type!: "custom" | "extractor";
  distube!: DisTube;
  init(distube: DisTube) {
    /**
     * DisTube
     * @type {DisTube}
     */
    this.distube = distube;
  }
  /**
   * Type of the plugin
   * @name Plugin#type
   * @type {PluginType}
   */
  /**
   * Emit the {@link DisTube} of this base
   * @param {string} eventName Event name
   * @param {...any} args arguments
   * @returns {boolean}
   */
  emit(eventName: keyof DisTubeEvents, ...args: any): boolean {
    return this.distube.emit(eventName, ...args);
  }
  /**
   * Emit error event
   * @param {Error} error error
   * @param {Discord.TextChannel?} channel Text channel where the error is encountered.
   */
  emitError(error: Error, channel?: TextChannel) {
    this.distube.emitError(error, channel);
  }
  /**
   * The queue manager
   * @type {QueueManager}
   * @readonly
   */
  get queues(): QueueManager {
    return this.distube.queues;
  }
  /**
   * The voice manager
   * @type {DisTubeVoiceManager}
   * @readonly
   */
  get voices(): DisTubeVoiceManager {
    return this.distube.voices;
  }
  /**
   * Discord.js client
   * @type {Discord.Client}
   * @readonly
   */
  get client(): Client {
    return this.distube.client;
  }
  /**
   * DisTube options
   * @type {DisTubeOptions}
   * @readonly
   */
  get options(): Options {
    return this.distube.options;
  }
  /**
   * DisTube handler
   * @type {DisTubeHandler}
   * @readonly
   */
  get handler(): DisTubeHandler {
    return this.distube.handler;
  }
  /**
   * Check if the url is working with this plugin
   * @param {string} url Input url
   * @returns {Promise<boolean>}
   */
  async validate(url: string): Promise<boolean> {
    return false;
  }
  /**
   * Get the stream url from {@link Song#url}. Returns {@link Song#url} by default.
   * Not needed if the plugin plays song from YouTube.
   * @param {string} url Input url
   * @returns {Promise<string>}
   */
  async getStreamURL(url: string): Promise<string> {
    return url;
  }
  /**
   * (Optional) Get related songs from a supported url. {@link Song#member} should be `undefined`.
   * Not needed to add {@link Song#related} because it will be added with this function later.
   * @param {string} url Input url
   * @returns {Promise<Song[]>}
   */
  async getRelatedSongs(url: string): Promise<Song[]> {
    return [];
  }
}

export default Plugin;
