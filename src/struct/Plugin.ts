/* eslint-disable  @typescript-eslint/no-unused-vars */
import type { Client, GuildTextBasedChannel } from "discord.js";
import type {
  Awaitable,
  DisTube,
  DisTubeEvents,
  DisTubeHandler,
  DisTubeVoiceManager,
  Options,
  PluginType,
  QueueManager,
  RelatedSong,
} from "..";

/**
 * DisTube Plugin
 * @abstract
 * @private
 */
export abstract class Plugin {
  type!: PluginType;
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
   * @param {Discord.BaseGuildTextChannel} [channel] Text channel where the error is encountered.
   */
  emitError(error: Error, channel?: GuildTextBasedChannel) {
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
   * Get the stream url from {@link Song#url}. Returns {@link Song#url} by default.
   * Not needed if the plugin plays song from YouTube.
   * @param {string} url Input url
   * @returns {string|Promise<string>}
   */
  getStreamURL(url: string): Awaitable<string> {
    return url;
  }
  /**
   * Get related songs from a supported url. {@link Song#member} should be `undefined`.
   * Not needed to add {@link Song#related} because it will be added with this function later.
   * @param {string} url Input url
   * @returns {Song[]|Promise<Song[]>}
   */
  getRelatedSongs(url: string): Awaitable<RelatedSong[]> {
    return [];
  }
}
