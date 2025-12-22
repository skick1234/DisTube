import type { GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { Song } from "../..";
import { checkFFmpeg, DisTubeError, DisTubeStream, Events, objectKeys, Queue, RepeatMode } from "../..";
import { GuildIdManager } from "./GuildIdManager";

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
      error: error => void this.#handlePlayingError(queue, error),
      finish: () => void this.handleSongFinish(queue),
    };
    for (const event of objectKeys(queue._listeners)) {
      queue.voice.on(event, queue._listeners[event]);
    }
  }

  /**
   * Handle the queue when a Song finish
   * @param queue - queue
   */
  async handleSongFinish(queue: Queue): Promise<void> {
    if (queue._manualUpdate) {
      queue._manualUpdate = false;
      await this.playSong(queue);
      return;
    }
    this.debug(`[QueueManager] Handling song finish: ${queue.id}`);
    const song = queue.songs[0];
    this.emit(Events.FINISH_SONG, queue, song);
    await queue._taskQueue.queuing();
    try {
      if (queue.stopped) return;
      if (queue.repeatMode === RepeatMode.QUEUE) queue.songs.push(song);

      if (queue.repeatMode !== RepeatMode.SONG) {
        const prev = queue.songs.shift() as Song;
        if (this.options.savePreviousSongs) queue.previousSongs.push(prev);
        else queue.previousSongs.push({ id: prev.id } as Song);
      }

      if (queue.songs.length === 0 && queue.autoplay) {
        try {
          this.debug(`[QueueManager] Adding related song: ${queue.id}`);
          await queue._addRelatedSong(song);
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          this.debug(`[${queue.id}] Add related song error: ${errorMessage}`);
          if (e instanceof DisTubeError) {
            this.emit(Events.NO_RELATED, queue, e);
          } else {
            this.emit(Events.NO_RELATED, queue, new DisTubeError("NO_RELATED"));
          }
        }
      }

      if (queue.songs.length === 0) {
        this.debug(`[${queue.id}] Queue is empty, stopping...`);
        if (!queue.autoplay) this.emit(Events.FINISH, queue);
        queue.remove();
        return;
      }

      if (song !== queue.songs[0]) {
        const playedSong = song.stream.playFromSource ? song : song.stream.song;
        if (playedSong?.stream.playFromSource) delete playedSong.stream.url;
      }
      await this.playSong(queue, true);
    } finally {
      queue._taskQueue.resolve();
    }
  }

  /**
   * Handle error while playing
   * @param queue - queue
   * @param error - error
   */
  async #handlePlayingError(queue: Queue, error: Error) {
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
      await this.playSong(queue);
    } else {
      this.debug(`[${queue.id}] Queue is empty, stopping...`);
      await queue.stop();
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
      await queue.stop();
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
      queue._beginTime = 0;
      const dtStream = new DisTubeStream(stream.url, streamOptions);
      dtStream.on("debug", data => this.emit(Events.FFMPEG_DEBUG, `[${queue.id}] ${data}`));
      this.debug(`[${queue.id}] Started playing: ${willPlaySong}`);
      await queue.voice.play(dtStream);
      if (emitPlaySong) this.emit(Events.PLAY_SONG, queue, song);
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.#handlePlayingError(queue, error);
    }
  }
}
