import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import { DiscordVoiceEngine, DiscordVoiceSession } from "@distube/voice-core/discord";
import type { Client, VoiceBasedChannel } from "discord.js";
import type {
  Adapter,
  Engine,
  EngineSettings,
  VoiceSession,
  VoiceSessionOptions,
  VoiceTarget,
} from "distube/integrations";

const DISCORD_DEFAULT_BITRATE = 64_000;

export class DiscordJSAdapter implements Adapter<VoiceBasedChannel> {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  normalizeTarget(channel: VoiceBasedChannel): VoiceTarget {
    if (channel.guild?.id && channel.guild.id !== channel.guildId) {
      throw new TypeError("Discord channel has conflicting guild identities");
    }
    return { guildId: channel.guildId, channelId: channel.id };
  }

  async createVoiceSession(target: VoiceTarget, options: VoiceSessionOptions): Promise<VoiceSession> {
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
      ...target,
      ...options,
      clientUserId,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      channelBitrate: channelId => {
        const current = guild.channels.cache.get(channelId);
        return current?.isVoiceBased() ? current.bitrate : DISCORD_DEFAULT_BITRATE;
      },
    });
  }

  createEngine(settings: EngineSettings): Engine {
    return new DiscordVoiceEngine(settings);
  }
}
