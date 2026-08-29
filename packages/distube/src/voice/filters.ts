import type { Engine, FilterEntry } from "../contracts";
import { ErrorReason } from "../enums";
import { DisTubeError, ErrorCode } from "../errors";

/** A change to the ordered filter set, folded when Voice dequeues it in the Player lane. */
export type FilterChange =
  | Readonly<{ kind: "upsert"; entry: FilterEntry }>
  | Readonly<{ kind: "remove"; names: readonly string[] }>
  | Readonly<{ kind: "clear" }>;

/** The settings side of the manager: the committed set plus changes serialized through the Voice Player lane. */
export interface FilterHost {
  entries(): readonly FilterEntry[];
  commit(change: FilterChange): Promise<void>;
}

export const NO_FILTERS: readonly FilterEntry[] = Object.freeze([]);

/**
 * A guild Voice's ordered named filter set.
 *
 * Core owns names, order, and opaque payloads; the engine owns definitions, rendering, and folding.
 * A change commits only after the engine renders the resulting set.
 */
export type VoiceFilters = {
  readonly active: readonly FilterEntry[];
  resolvable(name: string): boolean;
  apply(name: string, value?: number): Promise<void>;
  set(name: string, payload: unknown): Promise<void>;
  remove(...names: readonly string[]): Promise<void>;
  clear(): Promise<void>;
};

/** Package-private implementation of the VoiceFilters facade. */
export class VoiceFiltersImpl implements VoiceFilters {
  readonly #facade: VoiceFilters;
  readonly #engine: Engine;
  readonly #host: FilterHost;

  /** @internal */
  constructor(engine: Engine, host: FilterHost) {
    this.#engine = engine;
    this.#host = host;
    const self = this;
    const facade = {
      get active(): readonly FilterEntry[] {
        return self.active;
      },
      resolvable: this.resolvable.bind(this),
      apply: this.apply.bind(this),
      set: this.set.bind(this),
      remove: this.remove.bind(this),
      clear: this.clear.bind(this),
    };
    Object.freeze(facade);
    this.#facade = facade;
  }

  /** Package-private public view; the implementation never crosses the package boundary. */
  get facade(): VoiceFilters {
    return this.#facade;
  }

  /** The committed entries in application order. */
  get active(): readonly FilterEntry[] {
    return this.#host.entries();
  }

  /** Whether the engine can render `name` as a preset. */
  resolvable(name: string): boolean {
    return this.#engine.resolvable(validateFilterName(name));
  }

  /** Applies an engine-defined preset, replacing an already-active name where it already sits. */
  async apply(name: string, value?: number): Promise<void> {
    validateFilterName(name);
    validateFilterValue(value);
    if (!this.#engine.resolvable(name)) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, `Unknown filter: ${name}`);
    }
    await this.#host.commit({
      kind: "upsert",
      entry: Object.freeze({ name, ...(value === undefined ? {} : { value }) }),
    });
  }

  /** Applies an ad hoc engine-native payload under `name`; the engine validates the payload. */
  async set(name: string, payload: unknown): Promise<void> {
    validateFilterName(name);
    await this.#host.commit({ kind: "upsert", entry: Object.freeze({ name, payload }) });
  }

  /** Drops the named entries; names that are not active are ignored. */
  async remove(...names: readonly string[]): Promise<void> {
    for (const name of names) validateFilterName(name);
    await this.#host.commit({ kind: "remove", names: Object.freeze([...names]) });
  }

  async clear(): Promise<void> {
    await this.#host.commit({ kind: "clear" });
  }
}

/** The ordered set after `change`, keeping an already-active name at its current position. */
export function foldFilters(current: readonly FilterEntry[], change: FilterChange): readonly FilterEntry[] {
  switch (change.kind) {
    case "upsert": {
      const replaced = current.some(entry => entry.name === change.entry.name);
      return Object.freeze(
        replaced
          ? current.map(entry => (entry.name === change.entry.name ? change.entry : entry))
          : [...current, change.entry],
      );
    }
    case "remove": {
      const names = new Set(change.names);
      const kept = current.filter(entry => !names.has(entry.name));
      return kept.length === current.length ? current : Object.freeze(kept);
    }
    case "clear":
      return current.length === 0 ? current : NO_FILTERS;
  }
}

/** Whether two sets hold the same entries in the same order, so rendering would be a no-op. */
export function sameFilters(left: readonly FilterEntry[], right: readonly FilterEntry[]): boolean {
  return left === right || (left.length === right.length && left.every((entry, index) => entry === right[index]));
}

function validateFilterName(name: string): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "filter name must be a non-empty string");
  }
  return name;
}

function validateFilterValue(value: number | undefined): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "filter value must be a finite number");
  }
}
