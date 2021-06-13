import { DisTubeVoice } from ".";
import { Collection, StageChannel, VoiceChannel } from "discord.js";

/**
 * Manages voice connections for {@link DisTube}
 */
export class DisTubeVoiceManager {
  voices: Collection<string, DisTubeVoice>;
  constructor() {
    /**
     * A collection of {@link DisTubeVoice}
     * @type {Discord.Collection<string, DisTubeVoice>}
     */
    this.voices = new Collection();
  }
  create(channel: VoiceChannel | StageChannel): DisTubeVoice {
    const existing = this.get(channel.guild.id);
    if (existing) return existing;
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
    return new DisTubeVoice(this, channel).join();
  }
  /**
   * Leave the voice channel in the guild
   * @param {string} id Guild ID
   */
  leave(id: string) {
    this.voices.get(id)?.leave();
  }
  /**
   * Get a {@link DisTubeVoice} from a guild ID
   * @param {string} id Guild ID
   * @returns {DisTubeVoice?}
   */
  get(id: string): DisTubeVoice | undefined {
    return this.voices.get(id);
  }
}

export default DisTubeVoiceManager;
