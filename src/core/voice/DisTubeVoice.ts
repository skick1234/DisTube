import { TypedEmitter } from "tiny-typed-emitter";
import { DisTubeError, entersState, isSupportedVoiceChannel } from "../..";
import {
  AudioPlayerStatus,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
} from "@discordjs/voice";
import type { DisTubeStream, DisTubeVoiceEvents, DisTubeVoiceManager } from "../..";
import type { AudioPlayer, AudioResource, VoiceConnection } from "@discordjs/voice";
import type { Snowflake, VoiceBasedChannel, VoiceState } from "discord.js";

/**
 * Create a voice connection to the voice channel
 */
export class DisTubeVoice extends TypedEmitter<DisTubeVoiceEvents> {
  readonly id: Snowflake;
  readonly voices: DisTubeVoiceManager;
  readonly audioPlayer: AudioPlayer;
  connection!: VoiceConnection;
  audioResource?: AudioResource;
  emittedError!: boolean;
  isDisconnected = false;
  #channel!: VoiceBasedChannel;
  #volume = 100;
  constructor(voiceManager: DisTubeVoiceManager, channel: VoiceBasedChannel) {
    super();
    if (!isSupportedVoiceChannel(channel)) {
      throw new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", channel, "channel");
    }
    if (!channel.joinable) {
      if (channel.full) throw new DisTubeError("VOICE_FULL");
      else throw new DisTubeError("VOICE_MISSING_PERMS");
    }
    this.id = channel.guild.id;
    this.channel = channel;
    /**
     * The voice manager that instantiated this connection
     * @type {DisTubeVoiceManager}
     */
    this.voices = voiceManager;
    this.voices.add(this.id, this);
    this.audioPlayer = createAudioPlayer()
      .on(AudioPlayerStatus.Idle, oldState => {
        if (oldState.status !== AudioPlayerStatus.Idle) {
          delete this.audioResource;
          this.emit("finish");
        }
      })
      .on("error", error => {
        if (this.emittedError) return;
        this.emittedError = true;
        this.emit("error", error);
      });
    this.connection
      .on(VoiceConnectionStatus.Disconnected, (_, newState) => {
        if (newState.reason === VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5e3).catch(() => {
            this.leave();
          });
        } else if (this.connection.rejoinAttempts < 5) {
          setTimeout(() => {
            this.connection.rejoin();
          }, (this.connection.rejoinAttempts + 1) * 5e3).unref();
        } else if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          this.leave(new DisTubeError("VOICE_RECONNECT_FAILED"));
        }
      })
      .on(VoiceConnectionStatus.Destroyed, () => {
        this.leave(new DisTubeError("VOICE_RECONNECT_FAILED"));
      });
    this.connection.subscribe(this.audioPlayer);
    /**
     * Get or set the volume percentage
     * @name DisTubeVoice#volume
     * @type {number}
     */
  }
  get channel() {
    return this.#channel;
  }
  set channel(channel: VoiceBasedChannel) {
    if (!isSupportedVoiceChannel(channel)) {
      throw new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", channel, "DisTubeVoice#channel");
    }
    if (channel.guild.id !== this.id) throw new DisTubeError("VOICE_CHANGE_GUILD");
    this.connection = this.#join(channel);
    this.audioResource?.encoder?.setBitrate(channel.bitrate);
    this.#channel = channel;
  }
  #join(channel: VoiceBasedChannel) {
    return joinVoiceChannel({
      channelId: channel.id,
      guildId: this.id,
      adapterCreator: channel.guild.voiceAdapterCreator as any,
    });
  }
  /**
   * Join a voice channel with this connection
   * @param {Discord.BaseGuildVoiceChannel} [channel] A voice channel
   * @returns {Promise<DisTubeVoice>}
   */
  async join(channel?: VoiceBasedChannel): Promise<DisTubeVoice> {
    const TIMEOUT = 30e3;
    if (channel) {
      this.channel = channel;
    }
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, TIMEOUT);
    } catch {
      if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        this.connection.destroy();
      }
      this.voices.remove(this.id);
      throw new DisTubeError("VOICE_CONNECT_FAILED", TIMEOUT / 1e3);
    }
    return this;
  }
  /**
   * Leave the voice channel of this connection
   * @param {Error} [error] Optional, an error to emit with 'error' event.
   */
  leave(error?: Error) {
    this.stop(true);
    if (!this.isDisconnected) {
      this.emit("disconnect", error);
      this.isDisconnected = true;
    }
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    this.voices.remove(this.id);
  }
  /**
   * Stop the playing stream
   * @param {boolean} [force=false] If true, will force the {@link DisTubeVoice#audioPlayer} to enter the Idle state
   * even if the {@link DisTubeVoice#audioResource} has silence padding frames.
   * @private
   */
  stop(force = false) {
    this.audioPlayer.stop(force);
  }
  /**
   * Play a readable stream
   * @private
   * @param {DisTubeStream} stream Readable stream
   */
  play(stream: DisTubeStream) {
    this.emittedError = false;
    stream.stream.on("error", (error: NodeJS.ErrnoException) => {
      if (this.emittedError || error.code === "ERR_STREAM_PREMATURE_CLOSE") return;
      this.emittedError = true;
      this.emit("error", error);
    });
    this.audioResource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });
    this.volume = this.#volume;
    this.audioResource.encoder?.setBitrate(this.channel.bitrate);
    this.audioPlayer.play(this.audioResource);
  }
  set volume(volume: number) {
    if (typeof volume !== "number" || isNaN(volume)) {
      throw new DisTubeError("INVALID_TYPE", "number", volume, "volume");
    }
    if (volume < 0) {
      throw new DisTubeError("NUMBER_COMPARE", "Volume", "bigger or equal to", 0);
    }
    this.#volume = volume;
    this.audioResource?.volume?.setVolume(Math.pow(this.#volume / 100, 0.5 / Math.log10(2)));
  }
  get volume() {
    return this.#volume;
  }
  /**
   * Playback duration of the audio resource in seconds
   * @type {number}
   */
  get playbackDuration() {
    return (this.audioResource?.playbackDuration ?? 0) / 1000;
  }
  pause() {
    this.audioPlayer.pause();
  }
  unpause() {
    this.audioPlayer.unpause();
  }
  /**
   * Whether the bot is self-deafened
   * @type {boolean}
   */
  get selfDeaf(): boolean {
    return this.connection.joinConfig.selfDeaf;
  }
  /**
   * Whether the bot is self-muted
   * @type {boolean}
   */
  get selfMute(): boolean {
    return this.connection.joinConfig.selfMute;
  }
  /**
   * Self-deafens/undeafens the bot.
   * @param {boolean} selfDeaf Whether or not the bot should be self-deafened
   * @returns {boolean} true if the voice state was successfully updated, otherwise false
   */
  setSelfDeaf(selfDeaf: boolean): boolean {
    if (typeof selfDeaf !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", selfDeaf, "selfDeaf");
    }
    return this.connection.rejoin({
      ...this.connection.joinConfig,
      selfDeaf,
    });
  }
  /**
   * Self-mutes/unmutes the bot.
   * @param {boolean} selfMute Whether or not the bot should be self-muted
   * @returns {boolean} true if the voice state was successfully updated, otherwise false
   */
  setSelfMute(selfMute: boolean): boolean {
    if (typeof selfMute !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", selfMute, "selfMute");
    }
    return this.connection.rejoin({
      ...this.connection.joinConfig,
      selfMute,
    });
  }
  /**
   * The voice state of this connection
   * @type {Discord.VoiceState?}
   */
  get voiceState(): VoiceState | undefined {
    return this.channel?.guild?.me?.voice;
  }
}
