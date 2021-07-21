import DisTube from "../../DisTube";
import DisTubeBase from "../DisTubeBase";
import { Collection } from "discord.js";
import { GuildIDResolvable, resolveGuildID } from "../..";

/**
 * Manages the collection of a data model.
 * @abstract
 * @private
 */
export class BaseManager<V> extends DisTubeBase {
  collection: Collection<string, V>;
  constructor(distube: DisTube) {
    super(distube);
    /**
     * Collection of of a data model.
     * @type {Discord.Collection}
     */
    this.collection = new Collection();
  }
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

export default BaseManager;
