import { BaseManager } from ".";
import { DisTubeError } from "../..";
import type { FFmpegArgs, Filter, FilterResolvable, Queue } from "../..";

/**
 * Manage filters of a playing {@link Queue}
 */
export class FilterManager extends BaseManager<Filter> {
  /**
   * Collection of {@link Filter}.
   */
  queue: Queue;
  constructor(queue: Queue) {
    super(queue.distube);
    this.queue = queue;
  }

  #resolve(filter: FilterResolvable): Filter {
    if (typeof filter === "object" && typeof filter.name === "string" && typeof filter.value === "string") {
      return filter;
    }
    if (typeof filter === "string" && Object.prototype.hasOwnProperty.call(this.distube.filters, filter)) {
      return {
        name: filter,
        value: this.distube.filters[filter],
      };
    }
    throw new DisTubeError("INVALID_TYPE", "FilterResolvable", filter, "filter");
  }

  #apply() {
    this.queue.beginTime = this.queue.currentTime;
    this.queues.playSong(this.queue);
  }

  /**
   * Enable a filter or multiple filters to the manager
   *
   * @param filterOrFilters - The filter or filters to enable
   * @param override        - Wether or not override the applied filter with new filter value
   */
  add(filterOrFilters: FilterResolvable | FilterResolvable[], override = false) {
    if (Array.isArray(filterOrFilters)) {
      for (const filter of filterOrFilters) {
        const ft = this.#resolve(filter);
        if (override || !this.has(ft)) this.collection.set(ft.name, ft);
      }
    } else {
      const ft = this.#resolve(filterOrFilters);
      if (override || !this.has(ft)) this.collection.set(ft.name, ft);
    }
    this.#apply();
    return this;
  }

  /**
   * Clear enabled filters of the manager
   */
  clear() {
    return this.set([]);
  }

  /**
   * Set the filters applied to the manager
   *
   * @param filters - The filters to apply
   */
  set(filters: FilterResolvable[]) {
    if (!Array.isArray(filters)) throw new DisTubeError("INVALID_TYPE", "Array<FilterResolvable>", filters, "filters");
    this.collection.clear();
    for (const f of filters) {
      const filter = this.#resolve(f);
      this.collection.set(filter.name, filter);
    }
    this.#apply();
    return this;
  }

  #removeFn(f: FilterResolvable) {
    return this.collection.delete(this.#resolve(f).name);
  }

  /**
   * Disable a filter or multiple filters
   *
   * @param filterOrFilters - The filter or filters to disable
   */
  remove(filterOrFilters: FilterResolvable | FilterResolvable[]) {
    if (Array.isArray(filterOrFilters)) filterOrFilters.forEach(f => this.#removeFn(f));
    else this.#removeFn(filterOrFilters);
    this.#apply();
    return this;
  }

  /**
   * Check whether a filter enabled or not
   *
   * @param filter - The filter to check
   */
  has(filter: FilterResolvable) {
    return this.collection.has(typeof filter === "string" ? filter : this.#resolve(filter).name);
  }

  /**
   * Array of enabled filter names
   */
  get names(): string[] {
    return [...this.collection.keys()];
  }

  /**
   * Array of enabled filters
   */
  get values(): Filter[] {
    return [...this.collection.values()];
  }

  get ffmpegArgs(): FFmpegArgs {
    return this.size ? { af: this.values.map(f => f.value).join(",") } : {};
  }

  override toString() {
    return this.names.toString();
  }
}
