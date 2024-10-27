import { TypedEmitter } from "tiny-typed-emitter";
import {
  DisTubeError,
  DisTubeHandler,
  DisTubeVoiceManager,
  Events,
  Options,
  Playlist,
  QueueManager,
  Song,
  checkIntents,
  defaultFilters,
  isClientInstance,
  isMemberInstance,
  isMessageInstance,
  isNsfwChannel,
  isObject,
  isSupportedVoiceChannel,
  isTextChannelInstance,
  isURL,
  version,
} from ".";
import type { Client, VoiceBasedChannel } from "discord.js";
import type {
  Awaitable,
  CustomPlaylistOptions,
  DisTubeOptions,
  DisTubePlugin,
  Filters,
  GuildIdResolvable,
  PlayOptions,
  Queue,
  RepeatMode,
  TypedDisTubeEvents,
} from ".";

/**
 * DisTube class
 */
export class DisTube extends TypedEmitter<TypedDisTubeEvents> {
  /**
   * @event
   * Emitted after DisTube add a new playlist to the playing {@link Queue}.
   * @param queue    - The guild queue
   * @param playlist - Playlist info
   */
  static readonly [Events.ADD_LIST]: (queue: Queue, playlist: Playlist) => Awaitable;
  /**
   * @event
   * Emitted after DisTube add a new song to the playing {@link Queue}.
   * @param queue - The guild queue
   * @param song  - Added song
   */
  static readonly [Events.ADD_SONG]: (queue: Queue, song: Song) => Awaitable;
  /**
   * @event
   * Emitted when a {@link Queue} is deleted with any reasons.
   * @param queue - The guild queue
   */
  static readonly [Events.DELETE_QUEUE]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when the bot is disconnected to a voice channel.
   * @param queue - The guild queue
   */
  static readonly [Events.DISCONNECT]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when DisTube encounters an error while playing songs.
   * @param error   - error
   * @param queue   - The queue encountered the error
   * @param song    - The playing song when encountered the error
   */
  static readonly [Events.ERROR]: (error: Error, queue: Queue, song?: Song) => Awaitable;
  /**
   * @event
   * Emitted for logging FFmpeg debug information.
   * @param debug - Debug message string.
   */
  static readonly [Events.FFMPEG_DEBUG]: (debug: string) => Awaitable;
  /**
   * @event
   * Emitted to provide debug information from DisTube's operation.
   * Useful for troubleshooting or logging purposes.
   *
   * @param debug - Debug message string.
   */
  static readonly [Events.DEBUG]: (debug: string) => Awaitable;
  /**
   * @event
   * Emitted when there is no more song in the queue and {@link Queue#autoplay} is `false`.
   * @param queue - The guild queue
   */
  static readonly [Events.FINISH]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when DisTube finished a song.
   * @param queue - The guild queue
   * @param song  - Finished song
   */
  static readonly [Events.FINISH_SONG]: (queue: Queue, song: Song) => Awaitable;
  /**
   * @event
   * Emitted when DisTube initialize a queue to change queue default properties.
   * @param queue - The guild queue
   */
  static readonly [Events.INIT_QUEUE]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when {@link Queue#autoplay} is `true`, {@link Queue#songs} is empty, and
   * DisTube cannot find related songs to play.
   * @param queue - The guild queue
   */
  static readonly [Events.NO_RELATED]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when DisTube play a song.
   * If {@link DisTubeOptions}.emitNewSongOnly is `true`, this event is not emitted
   * when looping a song or next song is the previous one.
   * @param queue - The guild queue
   * @param song  - Playing song
   */
  static readonly [Events.PLAY_SONG]: (queue: Queue, song: Song) => Awaitable;
  /**
   * DisTube internal handler
   */
  readonly handler: DisTubeHandler;
  /**
   * DisTube options
   */
  readonly options: Options;
  /**
   * Discord.js v14 client
   */
  readonly client: Client;
  /**
   * Queues manager
   */
  readonly queues: QueueManager;
  /**
   * DisTube voice connections manager
   */
  readonly voices: DisTubeVoiceManager;
  /**
   * DisTube plugins
   */
  readonly plugins: DisTubePlugin[];
  /**
   * DisTube ffmpeg audio filters
   */
  readonly filters: Filters;
  /**
   * Create a new DisTube class.
   * @throws {@link DisTubeError}
   * @param client - Discord.JS client
   * @param opts   - Custom DisTube options
   */
  constructor(client: Client, opts: DisTubeOptions = {}) {
    super();
    this.setMaxListeners(1);
    if (!isClientInstance(client)) throw new DisTubeError("INVALID_TYPE", "Discord.Client", client, "client");
    this.client = client;
    checkIntents(client.options);
    this.options = new Options(opts);
    this.voices = new DisTubeVoiceManager(this);
    this.handler = new DisTubeHandler(this);
    this.queues = new QueueManager(this);
    this.filters = { ...defaultFilters, ...this.options.customFilters };
    this.plugins = [...this.options.plugins];
    this.plugins.forEach(p => p.init(this));
  }

  static get version() {
    return version;
  }

  /**
   * DisTube version
   */
  get version() {
    return version;
  }

  /**
   * Play / add a song or playlist from url.
   * Search and play a song (with {@link ExtractorPlugin}) if it is not a valid url.
   * @throws {@link DisTubeError}
   * @param voiceChannel - The channel will be joined if the bot isn't in any channels, the bot will be
   *                       moved to this channel if {@link DisTubeOptions}.joinNewVoiceChannel is `true`
   * @param song         - URL | Search string | {@link Song} | {@link Playlist}
   * @param options      - Optional options
   */
  async play<T = unknown>(
    voiceChannel: VoiceBasedChannel,
    song: string | Song | Playlist,
    options: PlayOptions<T> = {},
  ): Promise<void> {
    if (!isSupportedVoiceChannel(voiceChannel)) {
      throw new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", voiceChannel, "voiceChannel");
    }
    if (!isObject(options)) throw new DisTubeError("INVALID_TYPE", "object", options, "options");

    const { textChannel, member, skip, message, metadata } = {
      member: voiceChannel.guild.members.me ?? undefined,
      textChannel: options?.message?.channel,
      skip: false,
      ...options,
    };
    const position = Number(options.position) || (skip ? 1 : 0);

    if (message && !isMessageInstance(message)) {
      throw new DisTubeError("INVALID_TYPE", ["Discord.Message", "a falsy value"], message, "options.message");
    }
    if (textChannel && !isTextChannelInstance(textChannel)) {
      throw new DisTubeError("INVALID_TYPE", "Discord.GuildTextBasedChannel", textChannel, "options.textChannel");
    }
    if (member && !isMemberInstance(member)) {
      throw new DisTubeError("INVALID_TYPE", "Discord.GuildMember", member, "options.member");
    }

    const queue = this.getQueue(voiceChannel) || (await this.queues.create(voiceChannel, textChannel));
    await queue._taskQueue.queuing();
    try {
      this.debug(`[${queue.id}] Playing input: ${song}`);
      const resolved = await this.handler.resolve(song, { member, metadata });
      const isNsfw = isNsfwChannel(queue?.textChannel || textChannel);
      if (resolved instanceof Playlist) {
        if (!this.options.nsfw && !isNsfw) {
          resolved.songs = resolved.songs.filter(s => !s.ageRestricted);
          if (!resolved.songs.length) throw new DisTubeError("EMPTY_FILTERED_PLAYLIST");
        }
        if (!resolved.songs.length) throw new DisTubeError("EMPTY_PLAYLIST");
        this.debug(`[${queue.id}] Adding playlist to queue: ${resolved.songs.length} songs`);
        queue.addToQueue(resolved.songs, position);
        if (queue.playing || this.options.emitAddListWhenCreatingQueue) this.emit(Events.ADD_LIST, queue, resolved);
      } else {
        if (!this.options.nsfw && resolved.ageRestricted && !isNsfwChannel(queue?.textChannel || textChannel)) {
          throw new DisTubeError("NON_NSFW");
        }
        this.debug(`[${queue.id}] Adding song to queue: ${resolved.name || resolved.url || resolved.id || resolved}`);
        queue.addToQueue(resolved, position);
        if (queue.playing || this.options.emitAddSongWhenCreatingQueue) this.emit(Events.ADD_SONG, queue, resolved);
      }

      if (!queue.playing) await queue.play();
      else if (skip) await queue.skip();
    } catch (e: any) {
      if (!(e instanceof DisTubeError)) {
        this.debug(`[${queue.id}] Unexpected error while playing song: ${e.stack || e.message}`);
        try {
          e.name = "PlayError";
          e.message = `${typeof song === "string" ? song : song.url}\n${e.message}`;
        } catch {
          // Throw original error
        }
      }
      throw e;
    } finally {
      queue._taskQueue.resolve();
    }
  }

  /**
   * Create a custom playlist
   * @param songs   - Array of url or Song
   * @param options - Optional options
   */
  async createCustomPlaylist(
    songs: (string | Song)[],
    { member, parallel, metadata, name, source, url, thumbnail }: CustomPlaylistOptions = {},
  ): Promise<Playlist> {
    if (!Array.isArray(songs)) throw new DisTubeError("INVALID_TYPE", "Array", songs, "songs");
    if (!songs.length) throw new DisTubeError("EMPTY_ARRAY", "songs");
    const filteredSongs = songs.filter(song => song instanceof Song || isURL(song));
    if (!filteredSongs.length) throw new DisTubeError("NO_VALID_SONG");
    if (member && !isMemberInstance(member)) {
      throw new DisTubeError("INVALID_TYPE", "Discord.Member", member, "options.member");
    }
    let resolvedSongs: Song[];
    if (parallel !== false) {
      const promises = filteredSongs.map((song: string | Song) =>
        this.handler.resolve(song, { member, metadata }).catch(() => undefined),
      );
      resolvedSongs = (await Promise.all(promises)).filter((s): s is Song => s instanceof Song);
    } else {
      resolvedSongs = [];
      for (const song of filteredSongs) {
        const resolved = await this.handler.resolve(song, { member, metadata }).catch(() => undefined);
        if (resolved instanceof Song) resolvedSongs.push(resolved);
      }
    }
    return new Playlist(
      {
        source: source || "custom",
        name,
        url,
        thumbnail: thumbnail || resolvedSongs.find(s => s.thumbnail)?.thumbnail,
        songs: resolvedSongs,
      },
      { member, metadata },
    );
  }

  /**
   * Get the guild queue
   * @param guild - The type can be resolved to give a {@link Queue}
   */
  getQueue(guild: GuildIdResolvable): Queue | undefined {
    return this.queues.get(guild);
  }

  #getQueue(guild: GuildIdResolvable): Queue {
    const queue = this.getQueue(guild);
    if (!queue) throw new DisTubeError("NO_QUEUE");
    return queue;
  }

  /**
   * Pause the guild stream
   * @param guild - The type can be resolved to give a {@link Queue}
   * @returns The guild queue
   */
  pause(guild: GuildIdResolvable): Queue {
    return this.#getQueue(guild).pause();
  }

  /**
   * Resume the guild stream
   * @param guild - The type can be resolved to give a {@link Queue}
   * @returns The guild queue
   */
  resume(guild: GuildIdResolvable): Queue {
    return this.#getQueue(guild).resume();
  }

  /**
   * Stop the guild stream
   * @param guild - The type can be resolved to give a {@link Queue}
   */
  stop(guild: GuildIdResolvable): Promise<void> {
    return this.#getQueue(guild).stop();
  }

  /**
   * Set the guild stream's volume
   * @param guild   - The type can be resolved to give a {@link Queue}
   * @param percent - The percentage of volume you want to set
   * @returns The guild queue
   */
  setVolume(guild: GuildIdResolvable, percent: number): Queue {
    return this.#getQueue(guild).setVolume(percent);
  }

  /**
   * Skip the playing song if there is a next song in the queue. <info>If {@link
   * Queue#autoplay} is `true` and there is no up next song, DisTube will add and
   * play a related song.</info>
   * @param guild - The type can be resolved to give a {@link Queue}
   * @returns The new Song will be played
   */
  skip(guild: GuildIdResolvable): Promise<Song> {
    return this.#getQueue(guild).skip();
  }

  /**
   * Play the previous song
   * @param guild - The type can be resolved to give a {@link Queue}
   * @returns The new Song will be played
   */
  previous(guild: GuildIdResolvable): Promise<Song> {
    return this.#getQueue(guild).previous();
  }

  /**
   * Shuffle the guild queue songs
   * @param guild - The type can be resolved to give a {@link Queue}
   * @returns The guild queue
   */
  shuffle(guild: GuildIdResolvable): Promise<Queue> {
    return this.#getQueue(guild).shuffle();
  }

  /**
   * Jump to the song number in the queue. The next one is 1, 2,... The previous one
   * is -1, -2,...
   * @param guild - The type can be resolved to give a {@link Queue}
   * @param num   - The song number to play
   * @returns The new Song will be played
   */
  jump(guild: GuildIdResolvable, num: number): Promise<Song> {
    return this.#getQueue(guild).jump(num);
  }

  /**
   * Set the repeat mode of the guild queue.
   * Toggle mode `(Disabled -> Song -> Queue -> Disabled ->...)` if `mode` is `undefined`
   * @param guild - The type can be resolved to give a {@link Queue}
   * @param mode  - The repeat modes (toggle if `undefined`)
   * @returns The new repeat mode
   */
  setRepeatMode(guild: GuildIdResolvable, mode?: RepeatMode): RepeatMode {
    return this.#getQueue(guild).setRepeatMode(mode);
  }

  /**
   * Toggle autoplay mode
   * @param guild - The type can be resolved to give a {@link Queue}
   * @returns Autoplay mode state
   */
  toggleAutoplay(guild: GuildIdResolvable): boolean {
    const queue = this.#getQueue(guild);
    queue.autoplay = !queue.autoplay;
    return queue.autoplay;
  }

  /**
   * Add related song to the queue
   * @param guild - The type can be resolved to give a {@link Queue}
   * @returns The guild queue
   */
  addRelatedSong(guild: GuildIdResolvable): Promise<Song> {
    return this.#getQueue(guild).addRelatedSong();
  }

  /**
   * Set the playing time to another position
   * @param guild - The type can be resolved to give a {@link Queue}
   * @param time  - Time in seconds
   * @returns Seeked queue
   */
  seek(guild: GuildIdResolvable, time: number): Queue {
    return this.#getQueue(guild).seek(time);
  }

  /**
   * Emit error event
   * @param error   - error
   * @param queue   - The queue encountered the error
   * @param song    - The playing song when encountered the error
   */
  emitError(error: Error, queue: Queue, song?: Song): void {
    this.emit(Events.ERROR, error, queue, song);
  }

  /**
   * Emit debug event
   * @param message - debug message
   */
  debug(message: string) {
    this.emit(Events.DEBUG, message);
  }
}

export default DisTube;
