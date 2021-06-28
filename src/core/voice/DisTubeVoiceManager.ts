import { DisTubeVoice } from ".";
import { BaseManager } from "../managers";
import { QueueResolvable } from "../../types";
import { StageChannel, VoiceChannel } from "discord.js";
import { VoiceConnectionStatus, getVoiceConnection } from "@discordjs/voice";

/**
 * Manages voice connections for {@link DisTube}
 */
export class DisTubeVoiceManager extends BaseManager<DisTubeVoice, QueueResolvable> {
  /**
   * Get a {@link DisTubeVoice}.
   * @method get
   * @memberof DisTubeVoiceManager#
   * @param {QueueResolvable} queue The queue resolvable to resolve
   * @returns {DisTubeVoice?}
   */
  /**
   * Collection of {@link DisTubeVoice}.
   * @name DisTubeVoiceManager#collection
   * @type {Discord.Collection<string, DisTubeVoice>}
   */
  /**
   * Create a {@link DisTubeVoice}
   * @param {Discord.VoiceChannel|Discord.StageChannel} channel A voice channel to join
   * @returns {DisTubeVoice}
   * @private
   */
  create(channel: VoiceChannel | StageChannel): DisTubeVoice {
    const existing = this.get(channel.guild.id);
    if (existing) {
      return existing;
    }
    return new DisTubeVoice(this, channel);
  }
  /**
   * Join a voice channel
   * @param {Discord.VoiceChannel|Discord.StageChannel} channel A voice channel to join
   * @returns {Promise<DisTubeVoice>}
   */
  async join(channel: VoiceChannel | StageChannel): Promise<DisTubeVoice> {
    const existing = this.get(channel.guild.id);
    if (existing) {
      await existing.join(channel);
      return existing;
    }
    return this.create(channel).join();
  }
  /**
   * Leave the connected voice channel in a guild
   * @param {string} id Guild ID
   */
  leave(id: string) {
    const voice = this.get(id);
    if (voice) {
      voice.leave();
    } else {
      const connection = getVoiceConnection(id);
      if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
    }
  }
}

export default DisTubeVoiceManager;
