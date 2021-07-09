import DisTubeStream from "../DisTubeStream";
import { EventEmitter } from "events";
import { DisTubeVoiceManager } from "./DisTubeVoiceManager";
import { DisTubeError, createDiscordJSAdapter, isSupportedVoiceChannel } from "../..";
import { Snowflake, StageChannel, VoiceChannel } from "discord.js";
import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  VoiceConnection,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";

export declare interface DisTubeVoice {
  id: Snowflake;
  voices: DisTubeVoiceManager;
  audioPlayer: AudioPlayer;
  connection: VoiceConnection;
  audioResource?: AudioResource;
  emittedError: boolean;
  on(event: "disconnect", listener: (error?: Error) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "finish", listener: () => void): this;
}
/**
 * Create a voice connection to the voice channel
 */
export class DisTubeVoice extends EventEmitter {
  private _channel!: VoiceChannel | StageChannel;
  private _volume: number;
  constructor(voiceManager: DisTubeVoiceManager, channel: VoiceChannel | StageChannel) {
    super();
    if (!isSupportedVoiceChannel(channel)) {
      throw new DisTubeError("NOT_SUPPORTED_VOICE");
    }
    if (!channel.joinable) {
      if (channel.full) throw new DisTubeError("VOICE_FULL");
      else throw new DisTubeError("VOICE_MISSING_PERMS");
    }
    this.channel = channel;
    this.id = channel.guild.id;
    /**
     * The voice manager that instantiated this connection
     * @type {DisTubeVoiceManager}
     */
    this.voices = voiceManager;
    this.voices.add(this.id, this);
    this._volume = 0.5;
    this.audioPlayer = createAudioPlayer()
      .on("stateChange", (oldState, newState) => {
        if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
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
          entersState(this.connection, VoiceConnectionStatus.Connecting, 3e3).catch(() => {
            this.emit("disconnect");
            this.leave();
          });
        } else if (this.connection.rejoinAttempts < 5) {
          setTimeout(() => {
            this.connection.rejoin();
          }, (this.connection.rejoinAttempts + 1) * 5e3).unref();
        } else if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          this.emit("disconnect", new DisTubeError("VOICE_RECONNECT_FAILED"));
          this.leave();
        }
      })
      .on(VoiceConnectionStatus.Destroyed, () => {
        this.stop();
      })
      .on("error", error => {
        if (this.connection.state.status === VoiceConnectionStatus.Destroyed) {
          return;
        }
        if (this.connection.state.status === VoiceConnectionStatus.Disconnected) {
          this.connection.rejoin();
          entersState(this.connection, VoiceConnectionStatus.Ready, 30e3).catch(() => {
            if (this.connection.state.status === VoiceConnectionStatus.Destroyed) {
              return;
            }
            this.emit("disconnect", error);
            this.leave();
          });
        }
      });
    this.connection.subscribe(this.audioPlayer);
    /**
     * Get or set the volume percentage
     * @name DisTubeVoice#volume
     * @type {number}
     */
  }
  get channel() {
    return this._channel;
  }
  set channel(channel: VoiceChannel | StageChannel) {
    this.connection = this._join(channel);
    this._channel = channel;
  }
  private _join(channel: VoiceChannel | StageChannel) {
    return joinVoiceChannel({
      channelId: channel.id,
      guildId: this.id,
      // TODO: remove this after `@discordjs/voice` fixes typing problem
      adapterCreator: (channel.guild.voiceAdapterCreator as any) || createDiscordJSAdapter(channel),
    });
  }
  /**
   * Join a voice channel with this connection
   * @param {Discord.VoiceChannel|Discord.StageChannel} [channel] A voice channel
   * @private
   * @returns {Promise<DisTubeVoice>}
   */
  async join(channel?: VoiceChannel | StageChannel): Promise<DisTubeVoice> {
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
      this.voices.delete(this.id);
      throw new DisTubeError("VOICE_CONNECT_FAILED", TIMEOUT / 1e3);
    }
    return this;
  }
  /**
   * Leave the voice channel of this connection
   */
  leave() {
    this.stop();
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.voices.delete(this.id);
  }
  /**
   * Stop the playing stream
   * @private
   */
  stop() {
    this.audioPlayer.stop();
  }
  /**
   * Play a readable stream
   * @private
   * @param {DisTubeStream} stream Readable stream
   */
  play(stream: DisTubeStream) {
    this.emittedError = false;
    stream.stream.on("error", (error: NodeJS.ErrnoException) => {
      if (this.emittedError || error?.code === "ERR_STREAM_PREMATURE_CLOSE") return;
      this.emittedError = true;
      this.emit("error", error);
    });
    this.audioResource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });
    // eslint-disable-next-line no-self-assign
    this.volume = this.volume;
    this.audioPlayer.play(this.audioResource);
  }
  set volume(volume: number) {
    if (typeof volume !== "number") {
      throw new DisTubeError("INVALID_TYPE", "number", volume, "volume");
    }
    if (!(volume >= 0)) {
      throw new DisTubeError("NUMBER_COMPARE", "Volume", "bigger or equal to", 0);
    } // < 0 && NaN
    this._volume = volume / 100;
    this.audioResource?.volume?.setVolume(Math.pow(this._volume, 0.5 / Math.log10(2)));
  }
  get volume() {
    return this._volume * 100;
  }
  /**
   * Playback duration of the audio resource in seconds
   * @type {number}
   */
  get playbackDuration() {
    return (this.audioResource?.playbackDuration || 0) / 1000;
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
}

export default DisTubeVoice;
