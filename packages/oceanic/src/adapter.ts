import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import { DiscordVoiceEngine, DiscordVoiceSession } from "@distube/voice-core";
import type {
  Adapter,
  Engine,
  EngineSettings,
  VoiceSession,
  VoiceSessionOptions,
  VoiceTarget,
} from "distube/integrations";
import type {
  AnyGuildChannelWithoutThreads,
  ChannelTypes,
  Client,
  Guild,
  StageChannel,
  VoiceChannel,
} from "oceanic.js";

const DISCORD_DEFAULT_BITRATE = 64_000;
// oceanic.js's ES module entry uses top-level await, which require() cannot load, so its enum stays type-only.
const GUILD_VOICE: ChannelTypes.GUILD_VOICE = 2;
const GUILD_STAGE_VOICE: ChannelTypes.GUILD_STAGE_VOICE = 13;

function isVoiceBased(channel: AnyGuildChannelWithoutThreads | undefined): channel is VoiceChannel | StageChannel {
  return channel?.type === GUILD_VOICE || channel?.type === GUILD_STAGE_VOICE;
}

export class OceanicAdapter implements Adapter<VoiceChannel | StageChannel> {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  normalizeTarget(channel: VoiceChannel | StageChannel): VoiceTarget {
    if (channel.guild?.id && channel.guild.id !== channel.guildID) {
      throw new TypeError("Oceanic channel has conflicting guild identities");
    }
    return { guildId: channel.guildID, channelId: channel.id };
  }

  async createVoiceSession(target: VoiceTarget, options: VoiceSessionOptions): Promise<VoiceSession> {
    const guild = this.#client.guilds.get(target.guildId);
    if (!guild) throw new Error(`Oceanic guild is unavailable: ${target.guildId}`);
    const clientUserId = this.#client.user?.id;
    if (!clientUserId) throw new Error("Oceanic client user is unavailable");
    return await DiscordVoiceSession.connect({
      ...target,
      ...options,
      clientUserId,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      channelBitrate: channelId => {
        const current = guild.channels.get(channelId);
        return isVoiceBased(current) ? current.bitrate : DISCORD_DEFAULT_BITRATE;
      },
      preflight: channelId => preflight(guild, channelId, clientUserId),
    });
  }

  createEngine(settings: EngineSettings): Engine {
    return new DiscordVoiceEngine(settings);
  }
}

function preflight(guild: Guild, channelId: string, clientUserId: string): void {
  const channel = guild.channels.get(channelId);
  if (!channel) throw new Error(`Oceanic voice channel is unavailable: ${channelId}`);
  if (channel.guildID !== guild.id) {
    throw new Error(`Oceanic voice channel ${channelId} does not belong to guild ${guild.id}`);
  }
  if (!isVoiceBased(channel)) throw new Error(`Oceanic channel is not voice-capable: ${channelId}`);
  const permissions = channel.permissionsOf(clientUserId);
  if (!permissions.has("CONNECT")) throw new Error(`Oceanic voice channel ${channelId} denies the bot Connect`);
  if (channel.type !== GUILD_STAGE_VOICE && !permissions.has("SPEAK")) {
    throw new Error(`Oceanic voice channel ${channelId} denies the bot Speak`);
  }
  const full = channel.userLimit > 0 && channel.voiceMembers.size >= channel.userLimit;
  if (full && !permissions.has("MOVE_MEMBERS")) {
    throw new Error(`Oceanic voice channel ${channelId} is full and the bot lacks Move Members`);
  }
}
