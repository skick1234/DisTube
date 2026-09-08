import type { FfmpegFilterDefinitions } from "@distube/voice-core/core";
import type { Adapter, Engine, VoiceSession, VoiceTarget } from "distube/integrations";
import type { Client } from "eris";
import { ErisVoiceEngine, erisPreflight } from "./engine";
import { ErisVoiceSession } from "./session";

export interface ErisAdapterOptions {
  readonly connectionTimeoutMs?: number;
  readonly selfDeaf?: boolean;
  readonly selfMute?: boolean;
  /** Filter presets merged over the engine's built-in filter defaults. */
  readonly filters?: FfmpegFilterDefinitions;
}

export class ErisAdapter implements Adapter {
  readonly engine: Engine;
  readonly #client: Client;
  readonly #timeout: number;
  readonly #selfDeaf: boolean;
  readonly #selfMute: boolean;
  readonly #preflight: () => Promise<void>;

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
    this.#preflight = erisPreflight("@distube/eris");
    this.engine = new ErisVoiceEngine(options.filters, this.#preflight);
  }

  async createVoiceSession(target: VoiceTarget): Promise<VoiceSession> {
    ErisVoiceSession.assertTarget(this.#client, target.guildId, target.channelId);
    const clientUserId = this.#client.user?.id;
    if (!clientUserId) throw new Error("Eris client user is unavailable");
    await this.#preflight();
    return ErisVoiceSession.connect({
      client: this.#client,
      guildId: target.guildId,
      channelId: target.channelId,
      clientUserId,
      selfDeaf: this.#selfDeaf,
      selfMute: this.#selfMute,
      connectionTimeoutMs: this.#timeout,
    });
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}
