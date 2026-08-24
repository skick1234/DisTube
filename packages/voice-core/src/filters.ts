import {
  DisTubeError,
  ErrorCode,
  ErrorReason,
  type FilterDefinition,
  type FilterDefinitions,
  type FilterEntry,
  Filters,
} from "distube";

/** Preset definitions for an ffmpeg engine: a filter fragment, or a calculation from the entry's value. */
export type FfmpegFilterDefinitions = FilterDefinitions<string>;

/**
 * Built-in fragment for every conventional `Filters` name.
 *
 * Presets whose strength is a number are calculations, so `apply(name, value)` renders natively.
 */
export const DEFAULT_FILTERS: FfmpegFilterDefinitions = Object.freeze({
  [Filters.ThreeD]: "apulsator=hz=0.125",
  [Filters.Bassboost]: (value = 10) => `bass=g=${value}`,
  [Filters.Earwax]: "earwax",
  [Filters.Echo]: "aecho=0.8:0.9:1000:0.3",
  [Filters.Flanger]: "flanger",
  [Filters.Gate]: "agate",
  [Filters.Haas]: "haas",
  [Filters.Karaoke]: "stereotools=mlev=0.03",
  [Filters.Mcompand]: "mcompand",
  [Filters.Nightcore]: (value = 1.25) => `asetrate=48000*${value},aresample=48000,bass=g=5`,
  [Filters.Phaser]: "aphaser",
  [Filters.Reverse]: "areverse",
  [Filters.Surround]: "surround",
  [Filters.Tremolo]: "tremolo",
  [Filters.Vaporwave]: (value = 0.8) => `asetrate=48000*${value},aresample=48000,bass=g=5`,
});

/**
 * The engine's preset registry: built-in defaults with construction-time definitions merged over them.
 *
 * Core keeps filters named and ordered; this side owns what each name means and how the set folds into
 * the one `-af` chain ffmpeg accepts.
 */
export class FilterRegistry {
  readonly #definitions: Map<string, FilterDefinition<string>>;

  constructor(definitions: FfmpegFilterDefinitions = {}) {
    this.#definitions = new Map(Object.entries(DEFAULT_FILTERS));
    for (const [name, definition] of Object.entries(definitions)) {
      if (typeof definition !== "string" && typeof definition !== "function") {
        throw new TypeError(`Filter ${name} must be defined as an ffmpeg fragment or a calculation`);
      }
      this.#definitions.set(name, definition);
    }
  }

  resolvable(name: string): boolean {
    return this.#definitions.has(name);
  }

  /** Folds the ordered set into one ffmpeg filter chain, or `undefined` when nothing is active. */
  render(entries: readonly FilterEntry[]): string | undefined {
    const fragments = entries.map(entry => this.#fragment(entry)).filter(fragment => fragment.length > 0);
    return fragments.length > 0 ? fragments.join(",") : undefined;
  }

  /** Resolves one entry: an ad hoc payload as written, a preset through its definition. */
  #fragment(entry: FilterEntry): string {
    if (entry.payload !== undefined) {
      if (typeof entry.payload !== "string" || entry.payload.trim().length === 0) {
        throw new DisTubeError(
          ErrorCode.INVALID_ARGUMENT,
          ErrorReason.Argument,
          `Filter ${entry.name} payload must be an ffmpeg fragment`,
        );
      }
      return entry.payload.trim();
    }
    const definition = this.#definitions.get(entry.name);
    if (definition === undefined) {
      throw new DisTubeError(ErrorCode.UNSUPPORTED, `Filter ${entry.name} is not defined by this engine`);
    }
    return (typeof definition === "function" ? definition(entry.value) : definition).trim();
  }
}
