import DisTube from "../../DisTube";
import DisTubeBase from "../DisTubeBase";
import { Collection } from "discord.js";
import { DisTubeError } from "../../struct";

type GuildIDResolvable = string | { id?: string | null; guild?: { id?: string | null } | null };

/**
 * Manages the collection of a data model.
 * @abstract
 * @private
 */
export class BaseManager<V, R extends GuildIDResolvable> extends DisTubeBase {
  collection: Collection<string, V>;
  constructor(distube: DisTube) {
    super(distube);
    /**
     * Collection of of a data model.
     * @type {Discord.Collection}
     */
    this.collection = new Collection();
  }
  private resolveGuildID(idOrInstance: R | string): string {
    let guildID: string | null | undefined;
    if (typeof idOrInstance === "string") {
      guildID = idOrInstance;
    } else {
      guildID = idOrInstance.guild?.id || idOrInstance.id;
    }
    if (typeof guildID !== "string" || !guildID.match(/^\d+$/) || guildID.length <= 15) {
      throw new DisTubeError("INVALID_TYPE", "GuildIDResolvable", guildID);
    }
    return guildID;
  }
  add(id: string, data: V) {
    const existing = this.get(id);
    if (existing) {
      return existing;
    }
    this.collection.set(id, data);
    return data;
  }
  get(idOrInstance: R | string): V | undefined {
    return this.collection.get(this.resolveGuildID(idOrInstance));
  }
  delete(idOrInstance: R | string): void {
    this.collection.delete(this.resolveGuildID(idOrInstance));
  }
  has(idOrInstance: R | string): boolean {
    return this.collection.has(this.resolveGuildID(idOrInstance));
  }
}

export default BaseManager;
