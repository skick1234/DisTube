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
   * @param song        - First song
   * @param textChannel - Default text channel
   * @returns Returns `true` if encounter an error
   */
  async create(
    channel: VoiceBasedChannel,
    song: Song[] | Song,
    textChannel?: GuildTextBasedChannel,
  ): Promise<Queue | true> {
    if (this.has(channel.guildId)) throw new DisTubeError("QUEUE_EXIST");
    const voice = this.voices.create(channel);
    const queue = new Queue(this.distube, voice, song, textChannel);
    await queue._taskQueue.queuing();
    try {
      checkFFmpeg(this.distube);
      await voice.join();
      this.#voiceEventHandler(queue);
      this.add(queue.id, queue);
      this.emit(Events.INIT_QUEUE, queue);
      const err = await this.playSong(queue);
      return err || queue;
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
    return (
      !this.options.emitNewSongOnly ||
      (queue.repeatMode === RepeatMode.SONG && queue._next) ||
      (queue.repeatMode !== RepeatMode.SONG && queue.songs[0]?.id !== queue.songs[1]?.id)
    );
  }

  /**
   * Handle the queue when a Song finish
   * @param queue - queue
   */
  async #handleSongFinish(queue: Queue): Promise<void> {
    this.emit(Events.FINISH_SONG, queue, queue.songs[0]);
    await queue._taskQueue.queuing();
    try {
      if (queue.stopped) return;
      if (queue.repeatMode === RepeatMode.QUEUE && !queue._prev) queue.songs.push(queue.songs[0]);
      if (queue._prev) {
        if (queue.repeatMode === RepeatMode.QUEUE) queue.songs.unshift(queue.songs.pop() as Song);
        else queue.songs.unshift(queue.previousSongs.pop() as Song);
      }
      if (queue.songs.length <= 1 && (queue._next || queue.repeatMode === RepeatMode.DISABLED)) {
        if (queue.autoplay) {
          try {
            await queue.addRelatedSong();
          } catch (e: any) {
            this.emit(Events.NO_RELATED, queue, e);
          }
        }
        if (queue.songs.length <= 1) {
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
      const err = await this.playSong(queue);
      if (!err && emitPlaySong) this.emit(Events.PLAY_SONG, queue, queue.songs[0]);
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
    const song = queue.songs.shift() as Song;
    try {
      error.name = "PlayingError";
    } catch {
      // Emit original error
    }
    this.emitError(error, queue, song);
    if (queue.songs.length > 0) {
      queue._next = queue._prev = false;
      queue._beginTime = 0;
      this.playSong(queue).then(e => {
        if (!e) this.emit(Events.PLAY_SONG, queue, queue.songs[0]);
      });
    } else {
      queue.stop();
    }
  }

  /**
   * Play a song on voice connection
   * @param queue - The guild queue
   * @returns error?
   */
  async playSong(queue: Queue): Promise<boolean> {
    if (!queue) return true;
    if (queue.stopped || !queue.songs.length) {
      queue.stop();
      return true;
    }
    try {
      const song = queue.songs[0];
      await this.handler.attachStreamInfo(song);
      const { duration, stream } = song;
      let streamURL: string | undefined;
      if (stream.playFromSource) streamURL = stream.url;
      else if (stream.song?.stream.playFromSource) streamURL = stream.song.stream.url;
      if (!streamURL) throw new DisTubeError("NO_STREAM_URL", `${song.name || song.url || song.id}`);
      const streamOptions = {
        ffmpeg: {
          path: this.options.ffmpeg.path,
          args: {
            global: { ...queue.ffmpegArgs.global },
            input: { ...queue.ffmpegArgs.input },
            output: { ...queue.ffmpegArgs.output, ...queue.filters.ffmpegArgs },
          },
        },
        seek: duration ? queue._beginTime : undefined,
      };
      const dtStream = new DisTubeStream(streamURL, streamOptions);
      dtStream.on("debug", data => this.emit(Events.FFMPEG_DEBUG, `[${queue.id}]: ${data}`));
      queue.voice.play(dtStream);
      return false;
    } catch (e: any) {
      this.#handlePlayingError(queue, e);
      return true;
    }
  }
}
