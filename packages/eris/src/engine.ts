import type { Engine, Player, VoiceSession } from "distube";
import { type FfmpegFilterDefinitions, FilterRegistry } from "./filters";
import { ErisVoicePlayer } from "./player";
import { createPrerequisiteCheck } from "./prerequisites";
import { ErisVoiceSession } from "./session";

/**
 * The package's default voice engine: one long-lived Player per connected session.
 *
 * It owns the filter vocabulary, so core keeps the ordered named set and this side renders it.
 */
export class ErisVoiceEngine implements Engine {
  readonly #filters: FilterRegistry;
  readonly #preflight: () => Promise<void>;

  constructor(filters?: FfmpegFilterDefinitions, preflight: () => Promise<void> = createPrerequisiteCheck()) {
    this.#filters = new FilterRegistry(filters);
    this.#preflight = preflight;
  }

  async createPlayer(session: VoiceSession): Promise<Player> {
    const connection = ErisVoiceSession.connectionOf(session);
    if (!connection) throw new TypeError("This engine only plays through its own package's VoiceSession");
    return new ErisVoicePlayer(connection, this.#filters, this.#preflight);
  }

  resolvable(name: string): boolean {
    return this.#filters.resolvable(name);
  }
}
