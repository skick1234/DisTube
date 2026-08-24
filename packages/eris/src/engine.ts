import type { FfmpegFilterDefinitions } from "@distube/voice-core/core";
import {
  createPrerequisiteCheck,
  ERIS_ENCRYPTION_MODULES,
  ERIS_OPUS_MODULES,
  FilterRegistry,
} from "@distube/voice-core/core";
import type { Engine, PlaybackResource, Player, VoiceSession } from "distube";
import { ErisVoicePlayer } from "./player";
import { ErisVoiceSession } from "./session";

/**
 * The package's default voice engine: one long-lived Player per connected session.
 *
 * It owns the filter vocabulary, so core keeps the ordered named set and this side renders it.
 */
export class ErisVoiceEngine implements Engine {
  /** ffmpeg decodes a URL; a provider-encoded track means nothing to it. */
  readonly accepts: ReadonlySet<PlaybackResource["kind"]> = new Set(["url" as const]);
  readonly #filters: FilterRegistry;
  readonly #preflight: () => Promise<void>;

  constructor(
    filters?: FfmpegFilterDefinitions,
    preflight: () => Promise<void> = createPrerequisiteCheck({
      owner: "@distube/eris",
      encryption: ERIS_ENCRYPTION_MODULES,
      opus: ERIS_OPUS_MODULES,
    }),
  ) {
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
