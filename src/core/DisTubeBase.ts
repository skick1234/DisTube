import DisTube, { DisTubeOptions } from "../DisTube";
import Discord from "discord.js";

/** @private */
export class DisTubeBase {
  distube: DisTube;
  options: DisTubeOptions;
  client: Discord.Client;
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
