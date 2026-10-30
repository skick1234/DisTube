import type { Engine, FilterEntry } from "./contracts";
import { DisTubeError, ErrorCode } from "./errors";
import type { Connection, Guild } from "./guild";

/** One selected preset as `voice.filters.entries` reports it. */
export interface FilterSelection {
  readonly name: string;
  readonly value?: number;
  readonly label: string;
}

export const NO_FILTERS: readonly FilterEntry[] = Object.freeze([]);

/** A voice's ordered filter set. Each change renders through the Player and commits once it acknowledges. */
export class FilterManager {
  readonly #engine: Engine;
  readonly #guild: Pick<Guild<unknown>, "setFilters">;
  readonly #connection: Connection;

  /** @internal */
  constructor(engine: Engine, guild: Pick<Guild<unknown>, "setFilters">, connection: Connection) {
    this.#engine = engine;
    this.#guild = guild;
    this.#connection = connection;
  }

  get names(): readonly string[] {
    return this.#connection.entries.map(entry => entry.name);
  }

  get entries(): readonly FilterSelection[] {
    return this.#connection.entries.map(entry => ({
      ...entry,
      label: this.#engine.filters.get(entry.name)?.label ?? entry.name,
    }));
  }

  has(name: string): boolean {
    return this.#connection.entries.some(entry => entry.name === name);
  }

  /** Selects a preset, replacing its value in place when already selected. An omitted value uses the preset default. */
  async set(name: string, value?: number): Promise<void> {
    const entry = this.#resolve(name, value);
    return this.#guild.setFilters(this.#connection, entries => withEntry(entries, entry));
  }

  /** Removes a selected preset, otherwise behaves as `set`. */
  async toggle(name: string, value?: number): Promise<void> {
    const entry = this.#resolve(name, value);
    return this.#guild.setFilters(this.#connection, entries =>
      entries.some(existing => existing.name === name) ? withoutEntry(entries, name) : withEntry(entries, entry),
    );
  }

  remove(name: string): Promise<void> {
    return this.#guild.setFilters(this.#connection, entries => withoutEntry(entries, name));
  }

  clear(): Promise<void> {
    return this.#guild.setFilters(this.#connection, () => NO_FILTERS);
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
