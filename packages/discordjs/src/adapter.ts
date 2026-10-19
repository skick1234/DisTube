import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import type { FfmpegFilterDefinitions } from "@distube/voice-core/core";
import { DiscordVoiceEngine, DiscordVoiceSession, discordPreflight } from "@distube/voice-core/discord";
import type { Client, VoiceBasedChannel } from "discord.js";
import type { Adapter, Engine, JoinOptions, VoiceSession, VoiceTarget } from "distube/integrations";

export interface DiscordJSAdapterOptions {
  readonly connectionTimeoutMs?: number;
  /** Filter presets merged over the engine's built-in filter defaults. */
  readonly filters?: FfmpegFilterDefinitions;
}

export class DiscordJSAdapter implements Adapter<VoiceBasedChannel> {
  readonly engine: Engine;
  readonly #client: Client;
  readonly #timeout: number;
  readonly #preflight: () => Promise<void>;

  constructor(client: Client, options: DiscordJSAdapterOptions = {}) {
    if (!client) throw new TypeError("DiscordJSAdapter requires a discord.js Client");
    const timeout = options.connectionTimeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1) throw new TypeError("connectionTimeoutMs must be positive");
    this.#client = client;
    this.#timeout = timeout;
    this.#preflight = discordPreflight("@distube/discordjs");
    this.engine = new DiscordVoiceEngine(options.filters, this.#preflight);
  }

  normalizeTarget(channel: VoiceBasedChannel): VoiceTarget {
    if (channel.guild?.id && channel.guild.id !== channel.guildId) {
      throw new TypeError("Discord channel has conflicting guild identities");
    }
    return { guildId: channel.guildId, channelId: channel.id };
  }

  async createVoiceSession(target: VoiceTarget, options: JoinOptions = {}): Promise<VoiceSession> {
    const guild = this.#client.guilds.cache.get(target.guildId);
    if (!guild) throw new Error(`Discord guild is unavailable: ${target.guildId}`);
    const channel = guild.channels.cache.get(target.channelId);
    if (!channel) throw new Error(`Discord voice channel is unavailable: ${target.channelId}`);
    if (!channel.isVoiceBased()) throw new Error(`Discord channel is not voice-capable: ${target.channelId}`);
    if (channel.guildId !== target.guildId) {
      throw new Error(`Discord voice channel ${target.channelId} does not belong to guild ${target.guildId}`);
    }
    const clientUserId = this.#client.user?.id;
    if (!clientUserId) throw new Error("Discord client user is unavailable");
    return DiscordVoiceSession.connect({
      guildId: target.guildId,
      channelId: target.channelId,
      clientUserId,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: options.selfDeaf ?? true,
      selfMute: options.selfMute ?? false,
      connectionTimeoutMs: this.#timeout,
    });
  }
}
