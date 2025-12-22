import type { AudioPlayer, VoiceConnection } from "@discordjs/voice";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  entersState,
  joinVoiceChannel,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type { Snowflake, VoiceBasedChannel, VoiceState } from "discord.js";
import { Constants } from "discord.js";
import { TypedEmitter } from "tiny-typed-emitter";
import { JOIN_TIMEOUT_MS, RECONNECT_MAX_ATTEMPTS, RECONNECT_TIMEOUT_MS } from "../constant";
import { DisTubeError } from "../struct/DisTubeError";
import type { DisTubeVoiceEvents } from "../type";
import { checkEncryptionLibraries, isSupportedVoiceChannel } from "../util";
import type { DisTubeStream } from "./DisTubeStream";
import type { DisTubeVoiceManager } from "./manager/DisTubeVoiceManager";

/**
 * Create a voice connection to the voice channel
 */
export class DisTubeVoice extends TypedEmitter<DisTubeVoiceEvents> {
  readonly id: Snowflake;
  readonly voices: DisTubeVoiceManager;
  readonly audioPlayer: AudioPlayer;
  connection!: VoiceConnection;
  emittedError!: boolean;
  isDisconnected = false;
  stream?: DisTubeStream;
  pausingStream?: DisTubeStream;
  #channel!: VoiceBasedChannel;
  #volume = 100;
  constructor(voiceManager: DisTubeVoiceManager, channel: VoiceBasedChannel) {
    super();
    /**
     * The voice manager that instantiated this connection
     */
    this.voices = voiceManager;
    this.id = channel.guildId;
    this.channel = channel;
    this.voices.add(this.id, this);
    this.audioPlayer = createAudioPlayer()
      .on(AudioPlayerStatus.Idle, oldState => {
        if (oldState.status !== AudioPlayerStatus.Idle) this.emit("finish");
      })
      .on("error", (error: NodeJS.ErrnoException) => {
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
          entersState(this.connection, VoiceConnectionStatus.Connecting, RECONNECT_TIMEOUT_MS).catch(() => {
            if (
              ![VoiceConnectionStatus.Ready, VoiceConnectionStatus.Connecting].includes(this.connection.state.status)
            ) {
              this.leave();
            }
          });
        } else if (this.connection.rejoinAttempts < RECONNECT_MAX_ATTEMPTS) {
          // Try to rejoin
          setTimeout(
            () => {
              this.connection.rejoin();
            },
            (this.connection.rejoinAttempts + 1) * RECONNECT_TIMEOUT_MS,
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
  }
  /**
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
   * Join a voice channel with this connection
   * @param channel - A voice channel
   */
  async join(channel?: VoiceBasedChannel): Promise<DisTubeVoice> {
    if (channel) this.channel = channel;
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, JOIN_TIMEOUT_MS);
    } catch {
      if (this.connection.state.status === VoiceConnectionStatus.Ready) return this;
      if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
      this.voices.remove(this.id);
      throw new DisTubeError("VOICE_CONNECT_FAILED", JOIN_TIMEOUT_MS / 1000);
    }
    return this;
  }
  /**
   * Leave the voice channel of this connection
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
   * Stop the playing stream
   * @param force - If true, will force the {@link DisTubeVoice#audioPlayer} to enter the Idle state even
   *                if the {@link DisTubeStream#audioResource} has silence padding frames.
   */
  stop(force = false) {
    this.audioPlayer.stop(force);
  }
  #streamErrorHandler?: (error: NodeJS.ErrnoException) => void;
  /**
   * Play a {@link DisTubeStream}
   * @param dtStream - DisTubeStream
   */
  async play(dtStream: DisTubeStream) {
    if (!(await checkEncryptionLibraries())) {
      dtStream.kill();
      throw new DisTubeError("ENCRYPTION_LIBRARIES_MISSING");
    }
    this.emittedError = false;
    // Remove previous error listener to prevent memory leaks
    if (this.stream && this.#streamErrorHandler) {
      this.stream.off("error", this.#streamErrorHandler);
    }
    this.#streamErrorHandler = (error: NodeJS.ErrnoException) => {
      if (this.emittedError || error.code === "ERR_STREAM_PREMATURE_CLOSE") return;
      this.emittedError = true;
      this.emit("error", error);
    };
    dtStream.on("error", this.#streamErrorHandler);
    if (this.audioPlayer.state.status !== AudioPlayerStatus.Paused) {
      this.audioPlayer.play(dtStream.audioResource);
      this.stream?.kill();
      dtStream.spawn();
    } else if (!this.pausingStream) {
      this.pausingStream = this.stream;
    }
    this.stream = dtStream;
    this.volume = this.#volume;
  }
  set volume(volume: number) {
    if (typeof volume !== "number" || Number.isNaN(volume)) {
      throw new DisTubeError("INVALID_TYPE", "number", volume, "volume");
    }
    if (volume < 0) {
      throw new DisTubeError("NUMBER_COMPARE", "Volume", "bigger or equal to", 0);
    }
    this.#volume = volume;
    this.stream?.setVolume((this.#volume / 100) ** (0.5 / Math.log10(2)));
  }
  /**
   * Get or set the volume percentage
   */
  get volume() {
    return this.#volume;
  }
  /**
   * Playback duration of the audio resource in seconds
   */
  get playbackDuration() {
    return (this.stream?.audioResource?.playbackDuration ?? 0) / 1000;
  }
  pause() {
    this.audioPlayer.pause();
  }
  unpause() {
    const state = this.audioPlayer.state;
    if (state.status !== AudioPlayerStatus.Paused) return;
    if (this.stream?.audioResource && state.resource !== this.stream.audioResource) {
      this.audioPlayer.play(this.stream.audioResource);
      this.stream.spawn();
      this.pausingStream?.kill();
      delete this.pausingStream;
    } else {
      this.audioPlayer.unpause();
    }
  }
  /**
   * Whether the bot is self-deafened
   */
  get selfDeaf(): boolean {
    return this.connection.joinConfig.selfDeaf;
  }
  /**
   * Whether the bot is self-muted
   */
  get selfMute(): boolean {
    return this.connection.joinConfig.selfMute;
  }
  /**
   * Self-deafens/undeafens the bot.
   * @param selfDeaf - Whether or not the bot should be self-deafened
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
   * Self-mutes/unmutes the bot.
   * @param selfMute - Whether or not the bot should be self-muted
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
   * The voice state of this connection
   */
  get voiceState(): VoiceState | undefined {
    return this.channel?.guild?.members?.me?.voice;
  }
}
