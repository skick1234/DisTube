import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import type { FfmpegFilterDefinitions } from "@distube/voice-core/core";
import { DiscordVoiceEngine, DiscordVoiceSession, discordPreflight } from "@distube/voice-core/discord";
import type { Adapter, Engine, JoinOptions, VoiceSession, VoiceTarget } from "distube/integrations";
import { ChannelTypes, type Client, type VoiceChannel } from "oceanic.js";

export interface OceanicAdapterOptions {
  readonly connectionTimeoutMs?: number;
  /** Filter presets merged over the engine's built-in filter defaults. */
  readonly filters?: FfmpegFilterDefinitions;
}

export class OceanicAdapter implements Adapter<VoiceChannel> {
  readonly engine: Engine;
  readonly #client: Client;
  readonly #timeout: number;
  readonly #preflight: () => Promise<void>;

  constructor(client: Client, options: OceanicAdapterOptions = {}) {
    if (!client) throw new TypeError("OceanicAdapter requires an Oceanic Client");
    const timeout = options.connectionTimeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1) throw new TypeError("connectionTimeoutMs must be positive");
    this.#client = client;
    this.#timeout = timeout;
    this.#preflight = discordPreflight("@distube/oceanic");
    this.engine = new DiscordVoiceEngine(options.filters, this.#preflight);
  }

  normalizeTarget(channel: VoiceChannel): VoiceTarget {
    if (channel.guild?.id && channel.guild.id !== channel.guildID) {
      throw new TypeError("Oceanic channel has conflicting guild identities");
    }
    return { guildId: channel.guildID, channelId: channel.id };
  }

  async createVoiceSession(target: VoiceTarget, options: JoinOptions = {}): Promise<VoiceSession> {
    const guild = this.#client.guilds.get(target.guildId);
    if (!guild) throw new Error(`Oceanic guild is unavailable: ${target.guildId}`);
    const channel = guild.channels.get(target.channelId);
    if (!channel) throw new Error(`Oceanic voice channel is unavailable: ${target.channelId}`);
    if (channel.guildID !== target.guildId) {
      throw new Error(`Oceanic voice channel ${target.channelId} does not belong to guild ${target.guildId}`);
    }
    if (channel.type !== ChannelTypes.GUILD_VOICE && channel.type !== ChannelTypes.GUILD_STAGE_VOICE) {
      throw new Error(`Oceanic channel is not voice-capable: ${target.channelId}`);
    }
    const clientUserId = this.#client.user?.id;
    if (!clientUserId) throw new Error("Oceanic client user is unavailable");
    const adapterCreator = guild.voiceAdapterCreator;
    return DiscordVoiceSession.connect({
      guildId: target.guildId,
      channelId: target.channelId,
      clientUserId,
      adapterCreator: adapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: options.selfDeaf ?? true,
      selfMute: options.selfMute ?? false,
      connectionTimeoutMs: this.#timeout,
    });
  }
}
