import type DisTube from "../DisTube";
import type DisTubeHandler from "./DisTubeHandler";
import type { Client, TextChannel } from "discord.js";
import type { DisTubeVoiceManager, Options, QueueManager } from ".";

/** @private */
export class DisTubeBase {
  distube: DisTube;
  constructor(distube: DisTube) {
    /**
     * DisTube
     * @type {DisTube}
     * @private
     */
    this.distube = distube;
  }
  /**
   * Emit the {@link DisTube} of this base
   * @private
   * @param {string} eventName Event name
   * @param {...any} args arguments
   * @returns {boolean}
   */
  emit(eventName: string, ...args: any[]): boolean {
    return this.distube.emit(eventName, ...args);
  }
  /**
   * Emit error event
   * @param {Error} error error
   * @param {Discord.TextChannel?} channel Text channel where the error is encountered.
   * @private
   */
  emitError(error: Error, channel?: TextChannel) {
    this.distube.emitError(error, channel);
  }
  /**
   * The queue manager
   * @type {QueueManager}
   * @readonly
   * @private
   */
  get queues(): QueueManager {
    return this.distube.queues;
  }
  /**
   * The voice manager
   * @type {DisTubeVoiceManager}
   * @readonly
   * @private
   */
  get voices(): DisTubeVoiceManager {
    return this.distube.voices;
  }
  /**
   * Discord.js client
   * @type {Discord.Client}
   * @readonly
   * @private
   */
  get client(): Client {
    return this.distube.client;
  }
  /**
   * DisTube options
   * @type {DisTubeOptions}
   * @readonly
   * @private
   */
  get options(): Options {
    return this.distube.options;
  }
  /**
   * DisTube handler
   * @type {DisTubeHandler}
   * @readonly
   * @private
   */
  get handler(): DisTubeHandler {
    return this.distube.handler;
  }
}

export default DisTubeBase;
