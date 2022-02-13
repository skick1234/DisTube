import { BaseManager } from ".";
import { DisTubeError } from "../..";
import type { DisTube, FilterResolvable, Queue } from "../..";

/**
 * Manage filters of a playing {@link Queue}
 * @extends {BaseManager}
 */
export class FilterManager extends BaseManager<FilterResolvable> {
  queue: Queue;
  constructor(distube: DisTube, queue: Queue) {
    super(distube);
    this.queue = queue;
  }

  #validate(filter: FilterResolvable): FilterResolvable {
    if (
      (typeof filter === "string" && Object.prototype.hasOwnProperty.call(this.distube.filters, filter)) ||
      (typeof filter === "object" && typeof filter.name === "string" && typeof filter.value === "string")
    ) {
      return filter;
    }

    throw new DisTubeError("INVALID_TYPE", "FilterResolvable", filter, "filter");
  }

  #resolveName(filter: FilterResolvable): string {
    return typeof filter === "string" ? filter : filter.name;
  }

  #resolveValue(filter: FilterResolvable): string {
    return typeof filter === "string" ? this.distube.filters[filter] : filter.value;
  }

  #apply() {
    this.queue.beginTime = this.queue.currentTime;
    this.queues.playSong(this.queue);
  }

  /**
   * Enable a filter or multiple filters to the manager
   * @param {FilterResolvable|FilterResolvable[]} filterOrFilters The filter or filters to enable
   * @param {boolean} [override=false] Wether or not override the applied filter with new filter value
   * @returns {FilterManager}
   */
  add(filterOrFilters: FilterResolvable | FilterResolvable[], override = false) {
    if (Array.isArray(filterOrFilters)) {
      const resolvedFilters = filterOrFilters.map(f => this.#validate(f));
      const newFilters = resolvedFilters
        .reduceRight((unique, o: any) => {
          if (
            !unique.some((obj: any) => obj === o && obj.name === o) &&
            !unique.some((obj: any) => obj !== o.name && obj.name !== o.name)
          ) {
            if (!this.has(o)) unique.push(o);
            if (this.has(o) && override) {
              this.remove(o);
              unique.push(o);
            }
          }
          return unique;
        }, [] as FilterResolvable[])
        .reverse();
      return this.set([...this.collection.values(), ...newFilters]);
    }
    return this.set([...this.collection.values(), filterOrFilters]);
  }

  /**
   * Clear enabled filters of the manager
   * @returns {FilterManager}
   */
  clear() {
    return this.set([]);
  }

  /**
   * Set the filters applied to the manager
   * @param {FilterResolvable[]} filters The filters to apply
   * @returns {FilterManager}
   */
  set(filters: FilterResolvable[]) {
    this.collection.clear();
    for (const filter of filters) {
      const resolved = this.#validate(filter);
      this.collection.set(this.#resolveName(resolved), resolved);
    }
    this.#apply();
    return this;
  }

  /**
   * Disable a filter or multiple filters
   * @param {FilterResolvable|FilterResolvable[]} filterOrFilters The filter or filters to disable
   * @returns {FilterManager}
   */
  remove(filterOrFilters: FilterResolvable | FilterResolvable[]) {
    const remove = (f: FilterResolvable) => this.collection.delete(this.#resolveName(this.#validate(f)));
    if (Array.isArray(filterOrFilters)) filterOrFilters.map(remove);
    else remove(filterOrFilters);
    this.#apply();
    return this;
  }

  /**
   * Check whether a filter enabled or not
   * @param {FilterResolvable} filter The filter to check
   * @returns {boolean}
   */
  has(filter: FilterResolvable) {
    return this.collection.has(this.#resolveName(filter));
  }

  /**
   * Array of enabled filter name
   * @type {Array<string>}
   * @readonly
   */
  get names() {
    return this.collection.map(f => this.#resolveName(f));
  }

  get values() {
    return this.collection.map(f => this.#resolveValue(f));
  }

  toString() {
    return this.names.toString();
  }
}
