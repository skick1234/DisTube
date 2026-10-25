import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import { DiscordVoiceEngine, DiscordVoiceSession } from "@distube/voice-core";
import { ChannelType, type Client, type Guild, PermissionFlagsBits, type VoiceBasedChannel } from "discord.js";
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
    const clientUserId = this.#client.user?.id;
    if (!clientUserId) throw new Error("Discord client user is unavailable");
    return await DiscordVoiceSession.connect({
      ...target,
      ...options,
      clientUserId,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      channelBitrate: channelId => {
        const current = guild.channels.cache.get(channelId);
        return current?.isVoiceBased() ? current.bitrate : DISCORD_DEFAULT_BITRATE;
      },
      preflight: channelId => preflight(guild, channelId, clientUserId),
    });
  }

  createEngine(settings: EngineSettings): Engine {
    return new DiscordVoiceEngine(settings);
  }
}

function preflight(guild: Guild, channelId: string, clientUserId: string): void {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) throw new Error(`Discord voice channel is unavailable: ${channelId}`);
  if (!channel.isVoiceBased()) throw new Error(`Discord channel is not voice-capable: ${channelId}`);
  if (channel.guildId !== guild.id) {
    throw new Error(`Discord voice channel ${channelId} does not belong to guild ${guild.id}`);
  }
  const permissions = channel.permissionsFor(clientUserId);
  if (!permissions?.has(PermissionFlagsBits.Connect)) {
    throw new Error(`Discord voice channel ${channelId} denies the bot Connect`);
  }
  if (channel.type !== ChannelType.GuildStageVoice && !permissions.has(PermissionFlagsBits.Speak)) {
    throw new Error(`Discord voice channel ${channelId} denies the bot Speak`);
  }
  if (channel.full && !permissions.has(PermissionFlagsBits.MoveMembers)) {
    throw new Error(`Discord voice channel ${channelId} is full and the bot lacks Move Members`);
  }
}
