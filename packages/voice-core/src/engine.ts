import { DisTubeError } from "distube";
import type {
  Engine,
  EngineSettings,
  FilterDefinition,
  FilterDefinitionInfo,
  FilterDefinitions,
  FilterEntry,
  Player,
  PlayerOptions,
  VoiceSession,
} from "distube/integrations";
import { DiscordVoicePlayer } from "./player";
import { DiscordVoiceSession } from "./session";

/**
 * The built-in voice engine: in-process decoding and filtering over the session's own voice connection.
 *
 * It plays URL, file, stream, reader and timed resources and creates one Player per attached transport.
 */
export class DiscordVoiceEngine implements Engine {
  readonly filters: ReadonlyMap<string, FilterDefinitionInfo>;
  readonly #registry: FilterRegistry;
  readonly #settings: EngineSettings;

  constructor(settings: EngineSettings) {
    this.#registry = new FilterRegistry(settings.filters);
    this.filters = this.#registry.definitions;
    this.#settings = settings;
  }

  async createPlayer(session: VoiceSession, { onClosed }: PlayerOptions): Promise<Player> {
    if (!(session instanceof DiscordVoiceSession)) {
      throw new TypeError("This engine only plays through its own package's VoiceSession");
    }
    await loadDecoder();
    const connection = await DiscordVoiceSession.connectionOf(session);
    if (!connection) throw new TypeError("This engine only plays through its own package's VoiceSession");
    return new DiscordVoicePlayer({
      connection,
      session,
      filters: this.#registry,
      opusComplexity: this.#settings.opusComplexity,
      readAhead: this.#settings.bufferMs / 20,
      releaseTransport: () => DiscordVoiceSession.detachConnection(session, connection),
      onClosed,
    });
  }
}

async function loadDecoder(): Promise<void> {
  try {
    await import("node-av");
  } catch (error: unknown) {
    throw new DisTubeError(
      "VOICE_FAILED",
      "The built-in voice engine requires the node-av native binding, which runs on glibc 2.28 or newer (musl hosts such as Alpine are unsupported). Reinstall node-av on a supported host.",
      { cause: error },
    );
  }
}

/**
 * One preset for a local engine: `render` returns a plain libavfilter graph fragment. A definition with none of `default`, `min` or `max` is fixed and takes no value.
 */
export type FfmpegFilterDefinition = FilterDefinition<string>;

/** Construction-time `filters` option: preset name to definition, merged over the built-in defaults. */
export type FfmpegFilterDefinitions = FilterDefinitions<string>;

/**
 * Speed presets multiply the 48 kHz sample rate. Below 0.5x or above 2x the pitch shift stops sounding
 * like the preset and resampling cost climbs, so the ranges stop there.
 */
const rate = (value: number): string => `asetrate=48000*${value},aresample=48000,bass=g=5`;

/** Built-in definition for every conventional filter name. */
const DEFAULT_FILTERS: FfmpegFilterDefinitions = Object.freeze({
  "3d": fixed("apulsator=hz=0.125"),
  bassboost: { render: (value = 10) => `bass=g=${value}`, default: 10, min: 0, max: 20, label: v => `Bass +${v}dB` },
  earwax: fixed("earwax"),
  echo: fixed("aecho=0.8:0.9:1000:0.3"),
  flanger: fixed("flanger"),
  gate: fixed("agate"),
  haas: fixed("haas"),
  karaoke: fixed("stereotools=mlev=0.03"),
  mcompand: fixed("mcompand"),
  nightcore: { render: (value = 1.25) => rate(value), default: 1.25, min: 1, max: 2, label: v => `Nightcore x${v}` },
  phaser: fixed("aphaser"),
  surround: fixed("surround"),
  tremolo: fixed("tremolo"),
  vaporwave: { render: (value = 0.8) => rate(value), default: 0.8, min: 0.5, max: 1, label: v => `Vaporwave x${v}` },
});

function fixed(fragment: string): FfmpegFilterDefinition {
  return { render: () => fragment };
}

/**
 * The engine's preset registry: built-in defaults with construction-time definitions merged over them.
 *
 * Core keeps filters named and ordered; this side owns what each name means, which values it takes,
 * and how the set folds into one libavfilter chain.
 */
export class FilterRegistry {
  readonly #definitions = new Map<string, FfmpegFilterDefinition>();
  /** Range and label metadata per preset, the shape `Engine.filters` exposes. */
  readonly definitions: ReadonlyMap<string, FilterDefinitionInfo>;

  constructor(definitions: FfmpegFilterDefinitions = {}) {
    for (const [name, definition] of [...Object.entries(DEFAULT_FILTERS), ...Object.entries(definitions)]) {
      this.#definitions.set(name, validated(name, definition));
    }
    this.definitions = new Map([...this.#definitions].map(([name, definition]) => [name, info(name, definition)]));
  }

  /** Folds the ordered set into one libavfilter chain, or `undefined` when nothing is active. */
  render(entries: readonly FilterEntry[]): string | undefined {
    const fragments = entries.map(entry => this.#fragment(entry)).filter(fragment => fragment.length > 0);
    return fragments.length > 0 ? fragments.join(",") : undefined;
  }

  #fragment(entry: FilterEntry): string {
    const definition = this.#definitions.get(entry.name);
    if (definition === undefined) {
      throw new DisTubeError("UNSUPPORTED", `Filter ${entry.name} is not defined by this engine`);
    }
    const fragment = definition.render(entry.value);
    if (typeof fragment !== "string") {
      throw new DisTubeError("INVALID_ARGUMENT", `Filter ${entry.name} must render a libavfilter fragment`);
    }
    return fragment.trim();
  }
}

function acceptsValue(definition: FfmpegFilterDefinition): boolean {
  return definition.default !== undefined || definition.min !== undefined || definition.max !== undefined;
}

function info(name: string, definition: FfmpegFilterDefinition): FilterDefinitionInfo {
  const { label } = definition;
  return Object.freeze({
    default: definition.default,
    min: definition.min,
    max: definition.max,
    acceptsValue: acceptsValue(definition),
    label: (value?: number) => (typeof label === "function" ? label(value ?? definition.default) : (label ?? name)),
  });
}

/** Construction-time mistakes are programming errors, so they throw TypeError rather than a DisTubeError. */
function validated(name: string, definition: FfmpegFilterDefinition): FfmpegFilterDefinition {
  if (typeof definition !== "object" || definition === null || typeof definition.render !== "function") {
    throw new TypeError(`Filter ${name} must define a render function`);
  }
  for (const key of ["default", "min", "max"] as const) {
    const bound = definition[key];
    if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound))) {
      throw new TypeError(`Filter ${name} ${key} must be a finite number`);
    }
  }
  const min = definition.min ?? -Infinity;
  const max = definition.max ?? Infinity;
  if (min > max) throw new TypeError(`Filter ${name} min must not exceed max`);
  if (definition.default !== undefined && (definition.default < min || definition.default > max)) {
    throw new TypeError(`Filter ${name} default must lie within its range`);
  }
  if (
    definition.label !== undefined &&
    typeof definition.label !== "string" &&
    typeof definition.label !== "function"
  ) {
    throw new TypeError(`Filter ${name} label must be a string or a function`);
  }
  return definition;
}
