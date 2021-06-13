import DisTube from "../DisTube";
import { Client } from "discord.js";
import { DisTubeVoiceManager, Options, QueueManager } from ".";

/** @private */
export class DisTubeBase {
  distube: DisTube;
  options: Options;
  client: Client;
  voices: DisTubeVoiceManager;
  queues: QueueManager;
  constructor(distube: DisTube) {
    /**
     * DisTube
     * @type {DisTube}
     * @private
     */
    this.distube = distube;
    /**
     * DisTube options
     * @type {DisTubeOptions}
     * @private
     */
    this.options = this.distube.options;
    /**
     * Discord.js client
     * @type {Discord.Client}
     * @private
     */
    this.client = this.distube.client;
    /**
     * The voice manager
     * @type {DisTubeVoiceManager}
     * @private
     */
    this.voices = this.distube.voices;
    /**
     * The queue manager
     * @type {DisTubeVoiceManager}
     * @private
     */
    this.queues = this.distube.queues;
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
}

export default DisTubeBase;
