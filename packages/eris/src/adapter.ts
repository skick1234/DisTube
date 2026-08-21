import type { Adapter, Engine, VoiceSession, VoiceTarget } from "distube";
import type { Client } from "eris";
import { ErisVoiceEngine } from "./engine";
import type { FfmpegFilterDefinitions } from "./filters";
import { ErisVoiceSession } from "./session";
import { assertGuildVoiceChannel, positiveInteger } from "./validation";

export interface ErisAdapterOptions {
  readonly connectionTimeoutMs?: number;
  readonly selfDeaf?: boolean;
  readonly selfMute?: boolean;
  /** Filter presets merged over the engine's built-in `Filters` defaults. */
  readonly filters?: FfmpegFilterDefinitions;
}

export class ErisAdapter implements Adapter {
  readonly engine: Engine;
  readonly #client: Client;
  readonly #timeout: number;
  readonly #selfDeaf: boolean;
  readonly #selfMute: boolean;

  constructor(client: Client, options: ErisAdapterOptions = {}) {
    if (!client) throw new TypeError("ErisAdapter requires an Eris Client");
    this.#client = client;
    this.#timeout = positiveInteger(options.connectionTimeoutMs ?? 15_000, "connectionTimeoutMs");
    if (options.selfDeaf !== undefined && typeof options.selfDeaf !== "boolean") {
      throw new TypeError("selfDeaf must be boolean");
    }
    if (options.selfMute !== undefined && typeof options.selfMute !== "boolean") {
      throw new TypeError("selfMute must be boolean");
    }
    this.#selfDeaf = options.selfDeaf ?? true;
    this.#selfMute = options.selfMute ?? false;
    this.engine = new ErisVoiceEngine(options.filters);
  }

  async createVoiceSession(target: VoiceTarget): Promise<VoiceSession> {
    assertGuildVoiceChannel(this.#client, target.guildId, target.channelId);
    return ErisVoiceSession.connect({
      client: this.#client,
      guildId: target.guildId,
      channelId: target.channelId,
      selfDeaf: this.#selfDeaf,
      selfMute: this.#selfMute,
      connectionTimeoutMs: this.#timeout,
    });
  }
}
