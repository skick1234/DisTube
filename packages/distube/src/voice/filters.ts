import type { Engine, FilterDefinitionInfo, FilterEntry } from "../contracts";
import { DisTubeError } from "../errors";

/** One selected preset as `voice.filters.entries` reports it. */
export interface FilterSelection {
  readonly name: string;
  readonly value?: number;
  /** The engine definition's label rendered for `value`. */
  readonly label: string;
}

/** The voice-owned filter manager. Every mutation renders once through the Player and commits after acknowledgement. */
export interface FilterManager {
  /** Selects a preset, replacing its value in place when already selected. An omitted value uses the preset default. */
  set(name: string, value?: number): Promise<void>;
  /** Removes a selected preset, otherwise behaves as `set`. */
  toggle(name: string, value?: number): Promise<void>;
  remove(name: string): Promise<void>;
  clear(): Promise<void>;
  has(name: string): boolean;
  readonly names: readonly string[];
  readonly entries: readonly FilterSelection[];
  /** Every preset the engine renders, with its range and whether it accepts a value. */
  readonly definitions: ReadonlyMap<string, FilterDefinitionInfo>;
}

export const NO_FILTERS: readonly FilterEntry[] = Object.freeze([]);

/** Resolves one request against the engine's definitions: unknown presets reject, ranged values clamp. */
export function resolveFilterEntry(engine: Engine, name: string, value?: number): FilterEntry {
  if (typeof name !== "string" || name.length === 0)
    throw new DisTubeError("INVALID_ARGUMENT", "Filter name must be a non-empty string");
  const definition = engine.filters.get(name);
  if (!definition) throw new DisTubeError("UNSUPPORTED", `Engine cannot render filter ${name}`);
  if (value === undefined) {
    return Object.freeze(definition.default === undefined ? { name } : { name, value: definition.default });
  }
  if (!definition.acceptsValue) throw new DisTubeError("INVALID_ARGUMENT", `Filter ${name} does not accept a value`);
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new DisTubeError("INVALID_ARGUMENT", `Filter ${name} value must be a finite number`);
  const clamped = Math.min(Math.max(value, definition.min ?? -Infinity), definition.max ?? Infinity);
  return Object.freeze({ name, value: clamped });
}

/** Replaces a selected name in place, otherwise appends. */
export function withEntry(entries: readonly FilterEntry[], entry: FilterEntry): readonly FilterEntry[] {
  const index = entries.findIndex(existing => existing.name === entry.name);
  return Object.freeze(index < 0 ? [...entries, entry] : entries.toSpliced(index, 1, entry));
}

export function withoutEntry(entries: readonly FilterEntry[], name: string): readonly FilterEntry[] {
  return Object.freeze(entries.filter(entry => entry.name !== name));
}

/** A fold over the committed entries, evaluated by the voice when its turn on the Player lane comes. */
export type FilterChange = (entries: readonly FilterEntry[]) => readonly FilterEntry[];

/**
 * Builds the public manager over a voice's committed entries and its one render-and-commit path.
 *
 * Each mutation is a fold the voice applies at execution time, so unawaited changes stack in invocation
 * order instead of each overwriting the set committed when it was called.
 */
export function createFilterManager(
  engine: Engine,
  read: () => readonly FilterEntry[],
  commit: (change: FilterChange) => Promise<void>,
): FilterManager {
  const manager: FilterManager = {
    set: (name, value) => commit(entries => withEntry(entries, resolveFilterEntry(engine, name, value))),
    toggle: (name, value) =>
      commit(entries =>
        entries.some(entry => entry.name === name)
          ? withoutEntry(entries, name)
          : withEntry(entries, resolveFilterEntry(engine, name, value)),
      ),
    remove: name => commit(entries => withoutEntry(entries, name)),
    clear: () => commit(() => NO_FILTERS),
    has: name => read().some(entry => entry.name === name),
    get names(): readonly string[] {
      return Object.freeze(read().map(entry => entry.name));
    },
    get entries(): readonly FilterSelection[] {
      return Object.freeze(
        read().map(entry =>
          Object.freeze({
            ...entry,
            label: engine.filters.get(entry.name)?.label(entry.value) ?? entry.name,
          }),
        ),
      );
    },
    get definitions(): ReadonlyMap<string, FilterDefinitionInfo> {
      return engine.filters;
    },
  };
  return Object.freeze(manager);
}
