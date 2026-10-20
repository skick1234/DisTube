import type { Engine, FilterDefinitionInfo, PlaybackResource, Player, VoiceSession } from "distube/integrations";
import { type FfmpegFilterDefinitions, FilterRegistry } from "./filters";
import { DiscordVoicePlayer } from "./player";
import { createPrerequisiteCheck, DISCORD_ENCRYPTION_MODULES } from "./prerequisites";
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
  const check = createPrerequisiteCheck({ owner, encryption: DISCORD_ENCRYPTION_MODULES });
  preflights.set(owner, check);
  return check;
}

/**
 * The package's default voice engine: in-process decoding and filtering over the platform voice connection.
 *
 * It plays local URL, file, stream, reader and timed resources and creates one Player per attached transport.
 */
export class DiscordVoiceEngine implements Engine {
  /** libav decodes local input; a provider-encoded track means nothing to it. */
  readonly accepts: ReadonlySet<PlaybackResource["kind"]> = new Set(["url", "file", "stream", "reader", "timed"]);
  /** Files, seekable URLs, readers and timed resources open a second input at the requested position. */
  readonly capabilities = Object.freeze({ seek: true });
  readonly filters: ReadonlyMap<string, FilterDefinitionInfo>;
  readonly #filters: FilterRegistry;
  readonly #preflight: () => Promise<void>;

  constructor(filters?: FfmpegFilterDefinitions, preflight: () => Promise<void> = discordPreflight(DEFAULT_OWNER)) {
    this.#filters = new FilterRegistry(filters);
    this.filters = this.#filters.definitions;
    this.#preflight = preflight;
  }

  async createPlayer(session: VoiceSession): Promise<Player> {
    if (!(session instanceof DiscordVoiceSession)) {
      throw new TypeError("This engine only plays through its own package's VoiceSession");
    }
    await this.#preflight();
    const connection = await DiscordVoiceSession.connectionOf(session);
    if (!connection) throw new TypeError("This engine only plays through its own package's VoiceSession");
    return new DiscordVoicePlayer(connection, this.#filters, () => {
      DiscordVoiceSession.detachConnection(session, connection);
    });
  }
}
