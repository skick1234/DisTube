import { BaseManager } from ".";
import { resolveGuildId } from "../..";
import type { GuildIdResolvable } from "../..";

/**
 * Manages the collection of a data model paired with a guild id.
 * @abstract
 * @private
 * @extends BaseManager
 */
export abstract class GuildIdManager<V> extends BaseManager<V> {
  add(idOrInstance: GuildIdResolvable, data: V) {
    const id = resolveGuildId(idOrInstance);
    const existing = this.get(id);
    if (existing) return this;
    return this.collection.set(id, data);
  }
  get(idOrInstance: GuildIdResolvable): V | undefined {
    return this.collection.get(resolveGuildId(idOrInstance));
  }
  remove(idOrInstance: GuildIdResolvable): boolean {
    return this.collection.delete(resolveGuildId(idOrInstance));
  }
  has(idOrInstance: GuildIdResolvable): boolean {
    return this.collection.has(resolveGuildId(idOrInstance));
  }
}
