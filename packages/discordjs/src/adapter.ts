import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import { DiscordVoiceEngine, DiscordVoiceSession, type FfmpegFilterDefinitions } from "@distube/voice-core";
import type { Client } from "discord.js";
import type { Adapter, Engine, VoiceSession, VoiceTarget } from "distube";

export interface DiscordJSAdapterOptions {
  readonly connectionTimeoutMs?: number;
  /** Filter presets merged over the engine's built-in `Filters` defaults. */
  readonly filters?: FfmpegFilterDefinitions;
}

export class DiscordJSAdapter implements Adapter {
  readonly engine: Engine;
  readonly #client: Client;
  readonly #timeout: number;

  constructor(client: Client, options: DiscordJSAdapterOptions = {}) {
    if (!client) throw new TypeError("DiscordJSAdapter requires a discord.js Client");
    const timeout = options.connectionTimeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1) throw new TypeError("connectionTimeoutMs must be positive");
    this.#client = client;
    this.#timeout = timeout;
    this.engine = new DiscordVoiceEngine(options.filters);
  }

  async createVoiceSession(target: VoiceTarget): Promise<VoiceSession> {
    const guild = this.#client.guilds.cache.get(target.guildId);
    if (!guild) throw new Error(`Discord guild is unavailable: ${target.guildId}`);
    return DiscordVoiceSession.connect({
      guildId: target.guildId,
      channelId: target.channelId,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: true,
      selfMute: false,
      connectionTimeoutMs: this.#timeout,
    });
  }
}
