import type { Client, GuildTextBasedChannel } from "discord.js";
import type { DisTube, DisTubeEvents, DisTubeHandler, DisTubeVoiceManager, Options, QueueManager } from "..";

/**
 * @virtual
 */
export abstract class DisTubeBase {
  distube: DisTube;
  constructor(distube: DisTube) {
    /**
     * DisTube
     */
    this.distube = distube;
  }
  /**
   * Emit the {@link DisTube} of this base
   *
   * @param eventName - Event name
   * @param args      - arguments
   */
  emit(eventName: keyof DisTubeEvents, ...args: any): boolean {
    return this.distube.emit(eventName, ...args);
  }
  /**
   * Emit error event
   *
   * @param error   - error
   * @param channel - Text channel where the error is encountered.
   */
  emitError(error: Error, channel?: GuildTextBasedChannel) {
    this.distube.emitError(error, channel);
  }
  /**
   * The queue manager
   */
  get queues(): QueueManager {
    return this.distube.queues;
  }
  /**
   * The voice manager
   */
  get voices(): DisTubeVoiceManager {
    return this.distube.voices;
  }
  /**
   * Discord.js client
   */
  get client(): Client {
    return this.distube.client;
  }
  /**
   * DisTube options
   */
  get options(): Options {
    return this.distube.options;
  }
  /**
   * DisTube handler
   */
  get handler(): DisTubeHandler {
    return this.distube.handler;
  }
}
