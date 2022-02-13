import { DisTubeBase } from "..";
import { Collection } from "discord.js";

/**
 * Manages the collection of a data model.
 * @abstract
 * @private
 * @extends DisTubeBase
 */
export abstract class BaseManager<V> extends DisTubeBase {
  /**
   * The collection of items for this manager.
   * @type {Discord.Collection}
   */
  collection = new Collection<string, V>();
  /**
   * The size of the collection.
   * @type {Discord.Collection}
   * @abstract
   */
  get size() {
    return this.collection.size;
  }
}
