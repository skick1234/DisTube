import type { Client } from "discord.js";
import type { DisTube } from "../DisTube";
import type { Queue } from "../struct/Queue";
import type { Song } from "../struct/Song";
import type { DisTubeEvents, DisTubePlugin } from "../type";
import type { DisTubeHandler } from "./DisTubeHandler";
import type { Options } from "./DisTubeOptions";
import type { DisTubeVoiceManager } from "./manager/DisTubeVoiceManager";
import type { QueueManager } from "./manager/QueueManager";

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
   * @param eventName - Event name
   * @param args      - arguments
   */
  emit(eventName: keyof DisTubeEvents, ...args: any): boolean {
    return this.distube.emit(eventName, ...args);
  }
  /**
   * Emit error event
   * @param error   - error
   * @param queue   - The queue encountered the error
   * @param song    - The playing song when encountered the error
   */
  emitError(error: Error, queue: Queue, song?: Song) {
    this.distube.emitError(error, queue, song);
  }
  /**
   * Emit debug event
   * @param message - debug message
   */
  debug(message: string) {
    this.distube.debug(message);
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
  /**
   * DisTube plugins
   */
  get plugins(): DisTubePlugin[] {
    return this.distube.plugins;
  }
}
