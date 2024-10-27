import { GuildIdManager } from ".";
import { DisTubeError, DisTubeStream, Events, Queue, RepeatMode, checkFFmpeg, objectKeys } from "../..";
import type { Song } from "../..";
import type { GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";

/**
 * Queue manager
 */
export class QueueManager extends GuildIdManager<Queue> {
  /**
   * Create a {@link Queue}
   * @param channel     - A voice channel
   * @param textChannel - Default text channel
   * @returns Returns `true` if encounter an error
   */
  async create(channel: VoiceBasedChannel, textChannel?: GuildTextBasedChannel): Promise<Queue> {
    if (this.has(channel.guildId)) throw new DisTubeError("QUEUE_EXIST");
    this.debug(`[QueueManager] Creating queue for guild: ${channel.guildId}`);
    const voice = this.voices.create(channel);
    const queue = new Queue(this.distube, voice, textChannel);
    await queue._taskQueue.queuing();
    try {
      checkFFmpeg(this.distube);
      this.debug(`[QueueManager] Joining voice channel: ${channel.id}`);
      await voice.join();
      this.#voiceEventHandler(queue);
      this.add(queue.id, queue);
      this.emit(Events.INIT_QUEUE, queue);
      return queue;
    } finally {
      queue._taskQueue.resolve();
    }
  }

  /**
   * Listen to DisTubeVoice events and handle the Queue
   * @param queue - Queue
   */
  #voiceEventHandler(queue: Queue) {
    queue._listeners = {
      disconnect: error => {
        queue.remove();
        this.emit(Events.DISCONNECT, queue);
        if (error) this.emitError(error, queue, queue.songs?.[0]);
      },
      error: error => this.#handlePlayingError(queue, error),
      finish: () => this.#handleSongFinish(queue),
    };
    for (const event of objectKeys(queue._listeners)) {
      queue.voice.on(event, queue._listeners[event]);
    }
  }

  /**
   * Whether or not emit playSong event
   * @param queue - Queue
   */
  #emitPlaySong(queue: Queue): boolean {
    if (!this.options.emitNewSongOnly) return true;
    if (queue.repeatMode === RepeatMode.SONG) return queue._next || queue._prev;
    return queue.songs[0].id !== queue.songs[1].id;
  }

  /**
   * Handle the queue when a Song finish
   * @param queue - queue
   */
  async #handleSongFinish(queue: Queue): Promise<void> {
    this.debug(`[QueueManager] Handling song finish: ${queue.id}`);
    const song = queue.songs[0];
    this.emit(Events.FINISH_SONG, queue, queue.songs[0]);
    await queue._taskQueue.queuing();
    try {
      if (queue.stopped) return;
      if (queue.repeatMode === RepeatMode.QUEUE && !queue._prev) queue.songs.push(song);
      if (queue._prev) {
        if (queue.repeatMode === RepeatMode.QUEUE) queue.songs.unshift(queue.songs.pop() as Song);
        else queue.songs.unshift(queue.previousSongs.pop() as Song);
      }
      if (queue.songs.length <= 1 && (queue._next || queue.repeatMode === RepeatMode.DISABLED)) {
        if (queue.autoplay) {
          try {
            this.debug(`[QueueManager] Adding related song: ${queue.id}`);
            await queue.addRelatedSong();
          } catch (e: any) {
            this.debug(`[${queue.id}] Add related song error: ${e.message}`);
            this.emit(Events.NO_RELATED, queue, e);
          }
        }
        if (queue.songs.length <= 1) {
          this.debug(`[${queue.id}] Queue is empty, stopping...`);
          if (!queue.autoplay) this.emit(Events.FINISH, queue);
          queue.remove();
          return;
        }
      }
      const emitPlaySong = this.#emitPlaySong(queue);
      if (!queue._prev && (queue.repeatMode !== RepeatMode.SONG || queue._next)) {
        const prev = queue.songs.shift() as Song;
        if (this.options.savePreviousSongs) queue.previousSongs.push(prev);
        else queue.previousSongs.push({ id: prev.id } as Song);
      }
      queue._next = queue._prev = false;
      queue._beginTime = 0;
      if (song !== queue.songs[0]) {
        const playedSong = song.stream.playFromSource ? song : song.stream.song;
        if (playedSong?.stream.playFromSource) delete playedSong.stream.url;
      }
      await this.playSong(queue, emitPlaySong);
    } finally {
      queue._taskQueue.resolve();
    }
  }

  /**
   * Handle error while playing
   * @param queue - queue
   * @param error - error
   */
  #handlePlayingError(queue: Queue, error: Error) {
    const song = queue.songs.shift()!;
    try {
      error.name = "PlayingError";
    } catch {
      // Emit original error
    }
    this.debug(`[${queue.id}] Error while playing: ${error.stack || error.message}`);
    this.emitError(error, queue, song);
    if (queue.songs.length > 0) {
      this.debug(`[${queue.id}] Playing next song: ${queue.songs[0]}`);
      queue._next = queue._prev = false;
      queue._beginTime = 0;
      this.playSong(queue);
    } else {
      this.debug(`[${queue.id}] Queue is empty, stopping...`);
      queue.stop();
    }
  }

  /**
   * Play a song on voice connection with queue properties
   * @param queue         - The guild queue to play
   * @param emitPlaySong  - Whether or not emit {@link Events.PLAY_SONG} event
   */
  async playSong(queue: Queue, emitPlaySong = true) {
    if (!queue) return;
    if (queue.stopped || !queue.songs.length) {
      queue.stop();
      return;
    }
    try {
      const song = queue.songs[0];
      this.debug(`[${queue.id}] Getting stream from: ${song}`);
      await this.handler.attachStreamInfo(song);
      const willPlaySong = song.stream.playFromSource ? song : song.stream.song;
      const stream = willPlaySong?.stream;
      if (!willPlaySong || !stream?.playFromSource || !stream.url) throw new DisTubeError("NO_STREAM_URL", `${song}`);
      this.debug(`[${queue.id}] Creating DisTubeStream for: ${willPlaySong}`);
      const streamOptions = {
        ffmpeg: {
          path: this.options.ffmpeg.path,
          args: {
            global: { ...queue.ffmpegArgs.global },
            input: { ...queue.ffmpegArgs.input },
            output: { ...queue.ffmpegArgs.output, ...queue.filters.ffmpegArgs },
          },
        },
        seek: willPlaySong.duration ? queue._beginTime : undefined,
      };
      const dtStream = new DisTubeStream(stream.url, streamOptions);
      dtStream.on("debug", data => this.emit(Events.FFMPEG_DEBUG, `[${queue.id}] ${data}`));
      this.debug(`[${queue.id}] Started playing: ${willPlaySong}`);
      await queue.voice.play(dtStream);
      if (emitPlaySong) this.emit(Events.PLAY_SONG, queue, song);
    } catch (e: any) {
      this.#handlePlayingError(queue, e);
    }
  }
}
