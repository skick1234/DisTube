import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import { DiscordVoiceEngine, DiscordVoiceSession, type FfmpegFilterDefinitions } from "@distube/voice-core";
import type { Adapter, Engine, VoiceSession, VoiceTarget } from "distube";
import type { Client } from "oceanic.js";

export interface OceanicAdapterOptions {
  readonly connectionTimeoutMs?: number;
  /** Filter presets merged over the engine's built-in `Filters` defaults. */
  readonly filters?: FfmpegFilterDefinitions;
}

export class OceanicAdapter implements Adapter {
  readonly engine: Engine;
  readonly #client: Client;
  readonly #timeout: number;

  constructor(client: Client, options: OceanicAdapterOptions = {}) {
    if (!client) throw new TypeError("OceanicAdapter requires an Oceanic Client");
    const timeout = options.connectionTimeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1) throw new TypeError("connectionTimeoutMs must be positive");
    this.#client = client;
    this.#timeout = timeout;
    this.engine = new DiscordVoiceEngine(options.filters);
  }

  async createVoiceSession(target: VoiceTarget): Promise<VoiceSession> {
    const guild = this.#client.guilds.get(target.guildId);
    if (!guild) throw new Error(`Oceanic guild is unavailable: ${target.guildId}`);
    const adapterCreator = Reflect.get(guild, "voiceAdapterCreator");
    if (typeof adapterCreator !== "function") throw new Error("Oceanic guild does not expose a voice adapter creator");
    return DiscordVoiceSession.connect({
      guildId: target.guildId,
      channelId: target.channelId,
      adapterCreator: adapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: true,
      selfMute: false,
      connectionTimeoutMs: this.#timeout,
    });
  }
}
