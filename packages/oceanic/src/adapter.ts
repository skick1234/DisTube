import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import { DiscordVoiceEngine, DiscordVoiceSession } from "@distube/voice-core/discord";
import type {
  Adapter,
  Engine,
  EngineSettings,
  VoiceSession,
  VoiceSessionOptions,
  VoiceTarget,
} from "distube/integrations";
import {
  type AnyGuildChannelWithoutThreads,
  ChannelTypes,
  type Client,
  type StageChannel,
  type VoiceChannel,
} from "oceanic.js";

const DISCORD_DEFAULT_BITRATE = 64_000;

function isVoiceBased(channel: AnyGuildChannelWithoutThreads | undefined): channel is VoiceChannel | StageChannel {
  return channel?.type === ChannelTypes.GUILD_VOICE || channel?.type === ChannelTypes.GUILD_STAGE_VOICE;
}

export class OceanicAdapter implements Adapter<VoiceChannel> {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  normalizeTarget(channel: VoiceChannel): VoiceTarget {
    if (channel.guild?.id && channel.guild.id !== channel.guildID) {
      throw new TypeError("Oceanic channel has conflicting guild identities");
    }
    return { guildId: channel.guildID, channelId: channel.id };
  }

  async createVoiceSession(target: VoiceTarget, options: VoiceSessionOptions): Promise<VoiceSession> {
    const guild = this.#client.guilds.get(target.guildId);
    if (!guild) throw new Error(`Oceanic guild is unavailable: ${target.guildId}`);
    const channel = guild.channels.get(target.channelId);
    if (!channel) throw new Error(`Oceanic voice channel is unavailable: ${target.channelId}`);
    if (channel.guildID !== target.guildId) {
      throw new Error(`Oceanic voice channel ${target.channelId} does not belong to guild ${target.guildId}`);
    }
    if (!isVoiceBased(channel)) throw new Error(`Oceanic channel is not voice-capable: ${target.channelId}`);
    const clientUserId = this.#client.user?.id;
    if (!clientUserId) throw new Error("Oceanic client user is unavailable");
    return DiscordVoiceSession.connect({
      ...target,
      ...options,
      clientUserId,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      channelBitrate: channelId => {
        const current = guild.channels.get(channelId);
        return isVoiceBased(current) ? current.bitrate : DISCORD_DEFAULT_BITRATE;
      },
    });
  }

  createEngine(settings: EngineSettings): Engine {
    return new DiscordVoiceEngine(settings);
  }
}
