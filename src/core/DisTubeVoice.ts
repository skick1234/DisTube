import { Constants } from "discord.js";
import { TypedEmitter } from "tiny-typed-emitter";
import { DisTubeError, isSupportedVoiceChannel } from "..";
import {
  AudioPlayerStatus,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import type { Snowflake, VoiceBasedChannel, VoiceState } from "discord.js";
import type { DisTubeStream, DisTubeVoiceEvents, DisTubeVoiceManager } from "..";
import type { AudioPlayer, AudioResource, VoiceConnection } from "@discordjs/voice";

/**
 * @remarks
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
    /**
     * @remarks
     * The voice manager that instantiated this connection
     */
    this.voices = voiceManager;
    this.id = channel.guildId;
    this.channel = channel;
    this.voices.add(this.id, this);
    this.audioPlayer = createAudioPlayer()
      .on(AudioPlayerStatus.Idle, oldState => {
        if (oldState.status !== AudioPlayerStatus.Idle) {
          delete this.audioResource;
          this.emit("finish");
        }
      })
      .on(AudioPlayerStatus.Playing, () => this.#br())
      .on("error", error => {
        if (this.emittedError) return;
        this.emittedError = true;
        this.emit("error", error);
      });
    this.connection
      .on(VoiceConnectionStatus.Disconnected, (_, newState) => {
        if (newState.reason === VoiceConnectionDisconnectReason.Manual) {
          // User disconnect
          this.leave();
        } else if (newState.reason === VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014) {
          // Move to other channel
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5e3).catch(() => {
            if (
              ![VoiceConnectionStatus.Ready, VoiceConnectionStatus.Connecting].includes(this.connection.state.status)
            ) {
              this.leave();
            }
          });
        } else if (this.connection.rejoinAttempts < 5) {
          // Try to rejoin
          setTimeout(
            () => {
              this.connection.rejoin();
            },
            (this.connection.rejoinAttempts + 1) * 5e3,
          ).unref();
        } else if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          // Leave after 5 attempts
          this.leave(new DisTubeError("VOICE_RECONNECT_FAILED"));
        }
      })
      .on(VoiceConnectionStatus.Destroyed, () => {
        this.leave();
      })
      .on("error", () => undefined);
    this.connection.subscribe(this.audioPlayer);
    /**
     * @remarks
     * Get or set the volume percentage
     */
  }
  #br() {
    if (this.audioResource?.encoder?.encoder) this.audioResource.encoder.setBitrate(this.channel.bitrate);
  }
  /**
   * @remarks
   * The voice channel id the bot is in
   */
  get channelId() {
    return this.connection?.joinConfig?.channelId ?? undefined;
  }
  get channel() {
    if (!this.channelId) return this.#channel;
    if (this.#channel?.id === this.channelId) return this.#channel;
    const channel = this.voices.client.channels.cache.get(this.channelId);
    if (!channel) return this.#channel;
    for (const type of Constants.VoiceBasedChannelTypes) {
      if (channel.type === type) {
        this.#channel = channel;
        return channel;
      }
    }
    return this.#channel;
  }
  set channel(channel: VoiceBasedChannel) {
    if (!isSupportedVoiceChannel(channel)) {
      throw new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", channel, "DisTubeVoice#channel");
    }
    if (channel.guildId !== this.id) throw new DisTubeError("VOICE_DIFFERENT_GUILD");
    if (channel.client.user?.id !== this.voices.client.user?.id) throw new DisTubeError("VOICE_DIFFERENT_CLIENT");
    if (channel.id === this.channelId) return;
    if (!channel.joinable) {
      if (channel.full) throw new DisTubeError("VOICE_FULL");
      else throw new DisTubeError("VOICE_MISSING_PERMS");
    }
    this.connection = this.#join(channel);
    this.#channel = channel;
    this.#br();
  }
  #join(channel: VoiceBasedChannel) {
    return joinVoiceChannel({
      channelId: channel.id,
      guildId: this.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      group: channel.client.user?.id,
    });
  }
  /**
   * @remarks
   * Join a voice channel with this connection
   *
   * @param channel - A voice channel
   */
  async join(channel?: VoiceBasedChannel): Promise<DisTubeVoice> {
    const TIMEOUT = 30e3;
    if (channel) this.channel = channel;
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, TIMEOUT);
    } catch {
      if (this.connection.state.status === VoiceConnectionStatus.Ready) return this;
      if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
      this.voices.remove(this.id);
      throw new DisTubeError("VOICE_CONNECT_FAILED", TIMEOUT / 1e3);
    }
    return this;
  }
  /**
   * @remarks
   * Leave the voice channel of this connection
   *
   * @param error - Optional, an error to emit with 'error' event.
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
   * @remarks
   * Stop the playing stream
   *
   * @param force - If true, will force the {@link DisTubeVoice#audioPlayer} to enter the Idle state even
   *                if the {@link DisTubeVoice#audioResource} has silence padding frames.
   */
  stop(force = false) {
    this.audioPlayer.stop(force);
  }
  /**
   * @remarks
   * Play a readable stream
   *
   * @param stream - Readable stream
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
    if (this.audioPlayer.state.status !== AudioPlayerStatus.Paused) this.audioPlayer.play(this.audioResource);
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
   * @remarks
   * Playback duration of the audio resource in seconds
   */
  get playbackDuration() {
    return (this.audioResource?.playbackDuration ?? 0) / 1000;
  }
  pause() {
    this.audioPlayer.pause();
  }
  unpause() {
    const state = this.audioPlayer.state;
    if (state.status !== AudioPlayerStatus.Paused) return;
    if (this.audioResource && state.resource !== this.audioResource) this.audioPlayer.play(this.audioResource);
    else this.audioPlayer.unpause();
  }
  /**
   * @remarks
   * Whether the bot is self-deafened
   */
  get selfDeaf(): boolean {
    return this.connection.joinConfig.selfDeaf;
  }
  /**
   * @remarks
   * Whether the bot is self-muted
   */
  get selfMute(): boolean {
    return this.connection.joinConfig.selfMute;
  }
  /**
   * @remarks
   * Self-deafens/undeafens the bot.
   *
   * @param selfDeaf - Whether or not the bot should be self-deafened
   *
   * @returns true if the voice state was successfully updated, otherwise false
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
   * @remarks
   * Self-mutes/unmutes the bot.
   *
   * @param selfMute - Whether or not the bot should be self-muted
   *
   * @returns true if the voice state was successfully updated, otherwise false
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
   * @remarks
   * The voice state of this connection
   */
  get voiceState(): VoiceState | undefined {
    return this.channel?.guild?.members?.me?.voice;
  }
}
