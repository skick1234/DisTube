import DisTube from "../../DisTube";
import { DisTubeVoiceManager, Options } from "..";
import { DisTubeError, DisTubeHandler, Queue, QueueResolvable, Song } from "../..";
import { Client, Collection, StageChannel, TextChannel, VoiceChannel } from "discord.js";

/**
 * Queue manager
 */
export class QueueManager {
  client: Client;
  distube: DisTube;
  options: Options;
  handler: DisTubeHandler;
  queues: Collection<string, Queue>;
  voices: DisTubeVoiceManager;
  constructor(distube: DisTube) {
    this.distube = distube;
    this.options = this.distube.options;
    this.client = this.distube.client;
    this.voices = this.distube.voices;
    this.handler = this.distube.handler;
    this.queues = new Collection();
  }
  emit(eventName: string, ...args: any[]): boolean {
    return this.distube.emit(eventName, ...args);
  }
  /**
   * Emit error event
   * @param {Error} error error
   * @param {Discord.TextChannel?} channel Text channel where the error is encountered.
   * @private
   */
  emitError(error: Error, channel?: TextChannel) {
    this.distube.emitError(error, channel);
  }
  /**
   * Create a {@link Queue}
   * @param {Discord.VoiceChannel|Discord.StageChannel} channel A voice channel
   * @param {Song|Song[]} song First song
   * @param {Discord.TextChannel} textChannel Default text channel
   * @returns {Promise<Queue>}
   */
  async create(channel: VoiceChannel | StageChannel, song: Song[] | Song, textChannel?: TextChannel): Promise<Queue> {
    if (this.queues.has(channel.guild.id)) throw new DisTubeError("This guild has a Queue already", "QueueExist");
    if (!channel.joinable) {
      if (channel.full) throw new DisTubeError("The voice channel is full.", "JoinError");
      else throw new DisTubeError("You do not have permission to join this voice channel.", "JoinError");
    }
    const voice = this.distube.voices.create(channel);
    const queue = new Queue(this.distube, voice, song, textChannel);
    this._voiceEventHandler(queue);
    this.queues.set(queue.id, queue);
    await voice.join();
    return queue;
  }
  delete(queue: QueueResolvable) {
    const q = this.get(queue);
    if (q) this.queues.delete(q.id);
  }
  get(queue: QueueResolvable): Queue | undefined {
    if (queue instanceof Queue) return queue;
    let guildID: string | undefined;
    if (typeof queue === "string") guildID = queue;
    else guildID = queue?.guild?.id;
    if (
      typeof guildID !== "string" ||
      !guildID.match(/^\d+$/) ||
      guildID.length <= 15
    ) throw TypeError("The parameter must be a QueueResolvable!");
    return this.queues.get(guildID);
  }
  private _voiceEventHandler(queue: Queue) {
    queue.voice.on("disconnect", error => {
      queue.delete();
      this.distube.emit("error", error);
    }).on("error", error => {
      console.log("AudioPlayerError");
      this._handlePlayingError(queue, error);
    }).on("finish", () => {
      this._handleSongFinish(queue);
    });
  }
  /**
   * Handle the queue when a Song finish
   * @private
   * @param {Queue} queue queue
   * @returns {Promise<void>}
   */
  async _handleSongFinish(queue: Queue): Promise<void> {
    this.emit("finishSong", queue, queue.songs[0]);
    if (queue.stopped) return;
    if (queue.repeatMode === 2 && !queue.prev) queue.songs.push(queue.songs[0]);
    if (queue.prev) {
      if (queue.repeatMode === 2) queue.songs.unshift(queue.songs.pop() as Song);
      else queue.songs.unshift(queue.previousSongs.pop() as Song);
    }
    if (queue.songs.length <= 1 && (queue.next || !queue.repeatMode)) {
      if (queue.autoplay) try { await queue.addRelatedSong() } catch { this.emit("noRelated", queue) }
      if (queue.songs.length <= 1) {
        if (this.options.leaveOnFinish) queue.voice.leave();
        if (!queue.autoplay) this.emit("finish", queue);
        queue.delete();
        return;
      }
    }
    const emitPlaySong = this._emitPlaySong(queue);
    if (!queue.prev && (queue.repeatMode !== 1 || queue.next)) {
      const prev = queue.songs.shift() as Song;
      delete prev.info;
      delete prev.streamURL;
      if (this.options.savePreviousSongs) queue.previousSongs.push(prev);
      else queue.previousSongs.push({ id: prev.id } as Song);
    }
    queue.next = queue.prev = false;
    queue.beginTime = 0;
    const err = await this.handler.playSong(queue);
    if (!err && emitPlaySong) this.emit("playSong", queue, queue.songs[0]);
  }
  /**
   * Handle error while playing
   * @private
   * @param {Queue} queue queue
   * @param {Error} error error
   */
  _handlePlayingError(queue: Queue, error: Error) {
    const song = queue.songs.shift() as Song;
    try {
      error.name = "PlayingError";
      error.message = `${error.message}\nID: ${song.id}\nName: ${song.name}`;
    } catch { }
    this.emitError(error, queue.textChannel);
    if (queue.songs.length > 0) {
      this.handler.playSong(queue).then(e => {
        if (!e) this.emit("playSong", queue, queue.songs[0]);
      });
    } else queue.stop();
  }
  /**
   * Whether or not emit playSong event
   * @param {Queue} queue Queue
   * @private
   * @returns {boolean}
   */
  private _emitPlaySong(queue: Queue): boolean {
    if (
      !this.options.emitNewSongOnly ||
      (queue.repeatMode !== 1 && queue.songs[0]?.id !== queue.songs[1]?.id)
    ) return true;
    return false;
  }
}
