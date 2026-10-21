import { DisTubeError } from "distube";
import type { Engine, EngineSettings, FilterDefinitionInfo, Player, VoiceSession } from "distube/integrations";
import { FilterRegistry } from "./filters";
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

  async createPlayer(session: VoiceSession): Promise<Player> {
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
