import { DisTubeBase } from "..";
import { resolveGuildID } from "../..";
import { Collection } from "discord.js";
import type { GuildIDResolvable } from "../..";

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
   * @abstract
   */
  collection = new Collection<string, V>();
  add(id: string, data: V) {
    const existing = this.get(id);
    if (existing) {
      return existing;
    }
    this.collection.set(id, data);
    return data;
  }
  get(idOrInstance: GuildIDResolvable): V | undefined {
    return this.collection.get(resolveGuildID(idOrInstance));
  }
  delete(idOrInstance: GuildIDResolvable): void {
    this.collection.delete(resolveGuildID(idOrInstance));
  }
  has(idOrInstance: GuildIDResolvable): boolean {
    return this.collection.has(resolveGuildID(idOrInstance));
  }
}
