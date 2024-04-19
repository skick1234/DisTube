import { DisTubeVoice } from "../DisTubeVoice";
import { resolveGuildId } from "../..";
import { GuildIdManager } from ".";
import { VoiceConnectionStatus, getVoiceConnection } from "@discordjs/voice";
import type { GuildIdResolvable } from "../..";
import type { VoiceBasedChannel } from "discord.js";

/**
 * Manages voice connections for {@link DisTube}
 */
export class DisTubeVoiceManager extends GuildIdManager<DisTubeVoice> {
  /**
   * Get a {@link DisTubeVoice}.
   *
   * @param guild - The queue resolvable to resolve
   */
  /**
   * Collection of {@link DisTubeVoice}.
   */
  /**
   * Create a {@link DisTubeVoice}
   *
   * @param channel - A voice channel to join
   */
  create(channel: VoiceBasedChannel): DisTubeVoice {
    const existing = this.get(channel.guildId);
    if (existing) {
      existing.channel = channel;
      return existing;
    }
    return new DisTubeVoice(this, channel);
  }
  /**
   * Join a voice channel
   *
   * @param channel - A voice channel to join
   */
  join(channel: VoiceBasedChannel): Promise<DisTubeVoice> {
    const existing = this.get(channel.guildId);
    if (existing) return existing.join(channel);
    return this.create(channel).join();
  }
  /**
   * Leave the connected voice channel in a guild
   *
   * @param guild - Queue Resolvable
   */
  leave(guild: GuildIdResolvable) {
    const voice = this.get(guild);
    if (voice) {
      voice.leave();
    } else {
      const connection =
        getVoiceConnection(resolveGuildId(guild), this.client.user?.id) ?? getVoiceConnection(resolveGuildId(guild));
      if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
    }
  }
}
