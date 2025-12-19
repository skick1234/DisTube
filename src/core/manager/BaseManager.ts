import { Collection } from "discord.js";
import { DisTubeBase } from "../DisTubeBase";

/**
 * Manages the collection of a data model.
 */
export abstract class BaseManager<V> extends DisTubeBase {
  /**
   * The collection of items for this manager.
   */
  collection = new Collection<string, V>();
  /**
   * The size of the collection.
   */
  get size() {
    return this.collection.size;
  }
}
