import { DisTubeVoice } from ".";
import { resolveGuildID } from "../..";
import { BaseManager } from "../manager";
import { VoiceConnectionStatus, getVoiceConnection } from "@discordjs/voice";
import type { GuildIDResolvable } from "../..";
import type { VoiceBasedChannel } from "discord.js";

/**
 * Manages voice connections for {@link DisTube}
 */
export class DisTubeVoiceManager extends BaseManager<DisTubeVoice> {
  /**
   * Get a {@link DisTubeVoice}.
   * @method get
   * @memberof DisTubeVoiceManager#
   * @param {GuildIDResolvable} queue The queue resolvable to resolve
   * @returns {DisTubeVoice?}
   */
  /**
   * Collection of {@link DisTubeVoice}.
   * @name DisTubeVoiceManager#collection
   * @type {Discord.Collection<string, DisTubeVoice>}
   */
  /**
   * Create a {@link DisTubeVoice}
   * @param {Discord.VoiceBasedChannel} channel A voice channel to join
   * @returns {DisTubeVoice}
   * @private
   */
  create(channel: VoiceBasedChannel): DisTubeVoice {
    const existing = this.get(channel.guild.id);
    if (existing) {
      return existing;
    }
    return new DisTubeVoice(this, channel);
  }
  /**
   * Join a voice channel
   * @param {Discord.VoiceBasedChannel} channel A voice channel to join
   * @returns {Promise<DisTubeVoice>}
   */
  join(channel: VoiceBasedChannel): Promise<DisTubeVoice> {
    const existing = this.get(channel.guild.id);
    if (existing) return existing.join(channel);
    return this.create(channel).join();
  }
  /**
   * Leave the connected voice channel in a guild
   * @param {GuildIDResolvable} guild Queue Resolvable
   */
  leave(guild: GuildIDResolvable) {
    const voice = this.get(guild);
    if (voice) {
      voice.leave();
    } else {
      const connection = getVoiceConnection(resolveGuildID(guild));
      if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
    }
  }
}

export default DisTubeVoiceManager;
