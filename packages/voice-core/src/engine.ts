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
  VoiceSessionOptions,
  VoiceTarget,
} from "distube/integrations";
import { DiscordVoicePlayer } from "./player";
import { type DiscordPlatform, DiscordVoiceSession } from "./session";

export class DiscordVoiceEngine implements Engine {
  readonly filters: ReadonlyMap<string, FilterDefinitionInfo>;
  readonly #registry: FilterRegistry;
  readonly #settings: EngineSettings;
  readonly #platform: (target: VoiceTarget) => DiscordPlatform;

  constructor(settings: EngineSettings, platform: (target: VoiceTarget) => DiscordPlatform) {
    this.#registry = new FilterRegistry(settings.filters);
    this.filters = this.#registry.definitions;
    this.#settings = settings;
    this.#platform = platform;
  }

  async createVoiceSession(target: VoiceTarget, options: VoiceSessionOptions): Promise<VoiceSession> {
    return await DiscordVoiceSession.connect({ ...target, ...options, ...this.#platform(target) });
  }

  playbackRate(entries: readonly FilterEntry[]): number {
    return this.#registry.playbackRate(entries);
  }

  async createPlayer(session: VoiceSession, { onClosed }: PlayerOptions): Promise<Player> {
    if (!(session instanceof DiscordVoiceSession)) {
      throw new TypeError("This engine only plays through its own package's VoiceSession");
    }
    await loadDecoder();
    const connection = DiscordVoiceSession.connectionOf(session);
    if (!connection) throw new DisTubeError("INVALID_STATE", "The voice session was released");
    return new DiscordVoicePlayer({
      connection,
      session,
      filters: this.#registry,
      opusComplexity: this.#settings.opusComplexity,
      readAhead: this.#settings.bufferMs / 20,
      report: this.#settings.report,
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

export type FfmpegFilterDefinition = FilterDefinition<string>;

export type FfmpegFilterDefinitions = FilterDefinitions<string>;

function speed(label: string, fallback: number, min: number, max: number): FfmpegFilterDefinition {
  return {
    render: (value = fallback) => `asetrate=48000*${value},aresample=48000,bass=g=5`,
    tempo: (value = fallback) => value,
    default: fallback,
    min,
    max,
    label,
  };
}

const DEFAULT_FILTERS: FfmpegFilterDefinitions = Object.freeze({
  "3d": fixed("apulsator=hz=0.125"),
  bassboost: { render: (value = 10) => `bass=g=${value}`, default: 10, min: 0, max: 20, label: "Bass boost" },
  earwax: fixed("earwax"),
  echo: fixed("aecho=0.8:0.9:1000:0.3"),
  flanger: fixed("flanger"),
  gate: fixed("agate"),
  haas: fixed("haas"),
  karaoke: fixed("stereotools=mlev=0.03"),
  mcompand: fixed("mcompand"),
  nightcore: speed("Nightcore", 1.25, 1, 2),
  phaser: fixed("aphaser"),
  surround: fixed("surround"),
  tremolo: fixed("tremolo"),
  vaporwave: speed("Vaporwave", 0.8, 0.5, 1),
});

function fixed(fragment: string): FfmpegFilterDefinition {
  return { render: () => fragment };
}

export class FilterRegistry {
  readonly #definitions = new Map<string, FfmpegFilterDefinition>();
  readonly definitions: ReadonlyMap<string, FilterDefinitionInfo>;

  constructor(definitions: FfmpegFilterDefinitions = {}) {
    for (const [name, definition] of [...Object.entries(DEFAULT_FILTERS), ...Object.entries(definitions)]) {
      this.#definitions.set(name, validated(name, definition));
    }
    this.definitions = new Map([...this.#definitions].map(([name, definition]) => [name, info(name, definition)]));
  }

  render(entries: readonly FilterEntry[]): string | undefined {
    const fragments = entries.map(entry => this.#fragment(entry)).filter(fragment => fragment.length > 0);
    return fragments.length > 0 ? fragments.join(",") : undefined;
  }

  playbackRate(entries: readonly FilterEntry[]): number {
    let rate = 1;
    for (const entry of entries) {
      const { tempo = 1 } = this.#definition(entry);
      const value = typeof tempo === "function" ? tempo(entry.value) : tempo;
      if (!positive(value)) {
        throw new DisTubeError("INVALID_ARGUMENT", `Filter ${entry.name} tempo must be a finite number above 0`);
      }
      rate *= value;
    }
    return rate;
  }

  #definition(entry: FilterEntry): FfmpegFilterDefinition {
    const definition = this.#definitions.get(entry.name);
    if (definition === undefined) {
      throw new DisTubeError("UNSUPPORTED", `Filter ${entry.name} is not defined by this engine`);
    }
    return definition;
  }

  #fragment(entry: FilterEntry): string {
    const definition = this.#definition(entry);
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
  return Object.freeze({
    default: definition.default,
    min: definition.min,
    max: definition.max,
    acceptsValue: acceptsValue(definition),
    label: definition.label ?? name,
  });
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

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
  if (definition.label !== undefined && typeof definition.label !== "string") {
    throw new TypeError(`Filter ${name} label must be a string`);
  }
  const { tempo } = definition;
  if (tempo !== undefined && typeof tempo !== "function" && !positive(tempo)) {
    throw new TypeError(`Filter ${name} tempo must be a function or a finite number above 0`);
  }
  return definition;
}
