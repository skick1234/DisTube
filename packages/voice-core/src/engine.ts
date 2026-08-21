import type { Engine, Player, VoiceSession } from "distube";
import { type FfmpegFilterDefinitions, FilterRegistry } from "./filters";
import { DiscordVoicePlayer } from "./player";
import { createPrerequisiteCheck } from "./prerequisites";
import { DiscordVoiceSession } from "./session";

/**
 * The package's default voice engine: ffmpeg decoding and filtering over the platform voice connection.
 *
 * It plays `url` resources, owns the filter preset registry, and creates one long-lived Player per session.
 */
export class DiscordVoiceEngine implements Engine {
  readonly #filters: FilterRegistry;
  readonly #preflight: () => Promise<void>;

  constructor(filters?: FfmpegFilterDefinitions, preflight: () => Promise<void> = createPrerequisiteCheck()) {
    this.#filters = new FilterRegistry(filters);
    this.#preflight = preflight;
  }

  async createPlayer(session: VoiceSession): Promise<Player> {
    const connection = DiscordVoiceSession.connectionOf(session);
    if (!connection) throw new TypeError("This engine only plays through its own package's VoiceSession");
    return new DiscordVoicePlayer(connection, this.#filters, this.#preflight);
  }

  resolvable(name: string): boolean {
    return this.#filters.resolvable(name);
  }
}
