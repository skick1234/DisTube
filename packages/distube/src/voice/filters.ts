import type { Engine, FilterDefinitionInfo, FilterEntry } from "../contracts";
import { DisTubeError, ErrorCode } from "../errors";

/** One selected preset as `voice.filters.entries` reports it. */
export interface FilterSelection {
  readonly name: string;
  readonly value?: number;
  readonly label: string;
}

export type FilterChange = (entries: readonly FilterEntry[]) => readonly FilterEntry[];

export const NO_FILTERS: readonly FilterEntry[] = Object.freeze([]);

/** A voice's ordered filter set. Each change renders through the Player and commits once it acknowledges. */
export class FilterManager {
  readonly #engine: Engine;
  readonly #read: () => readonly FilterEntry[];
  readonly #commit: (change: FilterChange) => Promise<void>;

  constructor(engine: Engine, read: () => readonly FilterEntry[], commit: (change: FilterChange) => Promise<void>) {
    this.#engine = engine;
    this.#read = read;
    this.#commit = commit;
  }

  /** Every preset the engine renders. */
  get definitions(): ReadonlyMap<string, FilterDefinitionInfo> {
    return this.#engine.filters;
  }

  get names(): readonly string[] {
    return this.#read().map(entry => entry.name);
  }

  get entries(): readonly FilterSelection[] {
    return this.#read().map(entry => ({
      ...entry,
      label: this.#engine.filters.get(entry.name)?.label(entry.value) ?? entry.name,
    }));
  }

  has(name: string): boolean {
    return this.#read().some(entry => entry.name === name);
  }

  /** Selects a preset, replacing its value in place when already selected. An omitted value uses the preset default. */
  set(name: string, value?: number): Promise<void> {
    return this.#commit(entries => withEntry(entries, this.#resolve(name, value)));
  }

  /** Removes a selected preset, otherwise behaves as `set`. */
  toggle(name: string, value?: number): Promise<void> {
    return this.#commit(entries =>
      entries.some(entry => entry.name === name)
        ? withoutEntry(entries, name)
        : withEntry(entries, this.#resolve(name, value)),
    );
  }

  remove(name: string): Promise<void> {
    return this.#commit(entries => withoutEntry(entries, name));
  }

  clear(): Promise<void> {
    return this.#commit(() => NO_FILTERS);
  }

  #resolve(name: string, value: number | undefined): FilterEntry {
    if (typeof name !== "string" || !name)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Filter name must be a non-empty string");
    const definition = this.#engine.filters.get(name);
    if (!definition) throw new DisTubeError(ErrorCode.UNSUPPORTED, `Engine cannot render filter ${name}`);
    if (value === undefined) return definition.default === undefined ? { name } : { name, value: definition.default };
    if (!definition.acceptsValue)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Filter ${name} does not accept a value`);
    if (!Number.isFinite(value))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Filter ${name} value must be a finite number`);
    return { name, value: Math.min(Math.max(value, definition.min ?? -Infinity), definition.max ?? Infinity) };
  }
}

function withEntry(entries: readonly FilterEntry[], entry: FilterEntry): readonly FilterEntry[] {
  const index = entries.findIndex(existing => existing.name === entry.name);
  return index < 0 ? [...entries, entry] : entries.toSpliced(index, 1, entry);
}

function withoutEntry(entries: readonly FilterEntry[], name: string): readonly FilterEntry[] {
  return entries.filter(entry => entry.name !== name);
}
