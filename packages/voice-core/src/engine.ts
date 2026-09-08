import type { Engine, PlaybackResource, Player, VoiceSession } from "distube/integrations";
import { type FfmpegFilterDefinitions, FilterRegistry } from "./filters";
import { DiscordVoicePlayer } from "./player";
import { createPrerequisiteCheck, DISCORD_ENCRYPTION_MODULES, DISCORD_OPUS_MODULES } from "./prerequisites";
import { DiscordVoiceSession } from "./session";

/** Named when nothing else claims the engine, since this package's own name never reaches published output. */
const DEFAULT_OWNER = "The default voice engine";

/** One probe per owning package, reused by every engine instance, because it describes the process. */
const preflights = new Map<string, () => Promise<void>>();

/**
 * The shared prerequisite probe for `owner`, whose name the failure carries.
 *
 * Adapters pass their own package name so a bot operator is told which install to fix, rather than being
 * pointed at the voice library underneath.
 */
export function discordPreflight(owner: string): () => Promise<void> {
  const existing = preflights.get(owner);
  if (existing) return existing;
  const check = createPrerequisiteCheck({
    owner,
    encryption: DISCORD_ENCRYPTION_MODULES,
    opus: DISCORD_OPUS_MODULES,
  });
  preflights.set(owner, check);
  return check;
}

/**
 * The package's default voice engine: ffmpeg decoding and filtering over the platform voice connection.
 *
 * It plays `url` resources, owns the filter preset registry, and creates one long-lived Player per session.
 */
export class DiscordVoiceEngine implements Engine {
  /** ffmpeg decodes a URL; a provider-encoded track means nothing to it. */
  readonly accepts: ReadonlySet<PlaybackResource["kind"]> = new Set(["url" as const]);
  readonly #filters: FilterRegistry;
  readonly #preflight: () => Promise<void>;

  constructor(filters?: FfmpegFilterDefinitions, preflight: () => Promise<void> = discordPreflight(DEFAULT_OWNER)) {
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
