import { DisTubeBase } from "..";
import { Collection } from "discord.js";

/**
 * @remarks
 * Manages the collection of a data model.
 *
 * @virtual
 */
export abstract class BaseManager<V> extends DisTubeBase {
  /**
   * @remarks
   * The collection of items for this manager.
   */
  collection = new Collection<string, V>();
  /**
   * @remarks
   * The size of the collection.
   */
  get size() {
    return this.collection.size;
  }
}
