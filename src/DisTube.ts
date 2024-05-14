import { TypedEmitter } from "tiny-typed-emitter";
import {
  DirectLinkPlugin,
  DisTubeError,
  DisTubeHandler,
  DisTubeVoiceManager,
  Events,
  Options,
  Playlist,
  PluginType,
  QueueManager,
  Song,
  checkIntents,
  defaultFilters,
  isClientInstance,
  isMemberInstance,
  isMessageInstance,
  isObject,
  isSupportedVoiceChannel,
  isTextChannelInstance,
  isURL,
} from ".";
import type { Client, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type {
  Awaitable,
  CustomPlaylistOptions,
  DisTubeOptions,
  ExtractorPlugin,
  Filters,
  GuildIdResolvable,
  PlayOptions,
  Queue,
  TypedDisTubeEvents,
} from ".";

// Cannot be `import` as it's not under TS root dir
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
export const { version }: { version: string } = require("../package.json");

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface DisTube extends TypedEmitter<TypedDisTubeEvents> {
  /**
   * @event
   * Emitted after DisTube add a new playlist to the playing {@link Queue}.
   *
   * @example
   * ```ts
   * distube.on("addList", (queue, playlist) => queue.textChannel.send(
   *     `Added \`${playlist.name}\` playlist (${playlist.songs.length} songs) to the queue!`
   * ));
   * ```
   *
   * @param queue    - The guild queue
   * @param playlist - Playlist info
   */
  [Events.ADD_LIST]: (queue: Queue, playlist: Playlist) => Awaitable;
  /**
   * @event
   * Emitted after DisTube add a new song to the playing {@link Queue}.
   *
   * @example
   * ```ts
   * distube.on("addSong", (queue, song) => queue.textChannel.send(
   *     `Added ${song.name} - \`${song.formattedDuration}\` to the queue by ${song.user}.`
   * ));
   * ```
   *
   * @param queue - The guild queue
   * @param song  - Added song
   */
  [Events.ADD_SONG]: (queue: Queue, song: Song) => Awaitable;
  /**
   * @event
   * Emitted when a {@link Queue} is deleted with any reasons.
   *
   * @param queue - The guild queue
   */
  [Events.DELETE_QUEUE]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when the bot is disconnected to a voice channel.
   *
   * @param queue - The guild queue
   */
  [Events.DISCONNECT]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when there is no user in the voice channel, {@link DisTubeOptions}.leaveOnEmpty
   * is `true` and there is a playing queue.
   *
   * If there is no playing queue (stopped and {@link DisTubeOptions}.leaveOnStop is
   * `false`), it will leave the channel without emitting this event.
   *
   * @example
   * ```ts
   * distube.on("empty", queue => queue.textChannel.send("Channel is empty. Leaving the channel"))
   * ```
   *
   * @param queue - The guild queue
   */
  [Events.EMPTY]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when DisTube encounters an error while playing songs.
   *
   * @example
   * ```ts
   * distube.on('error', (channel, e) => {
   *     if (channel) channel.send(`An error encountered: ${e}`)
   *     else console.error(e)
   * })
   * ```
   *
   * @param channel - Text channel where the error is encountered.
   * @param error   - The error encountered
   */
  [Events.ERROR]: (channel: GuildTextBasedChannel | undefined, error: Error) => Awaitable;
  /**
   * @event
   * Emitted for FFmpeg debugging information.
   *
   * @param debug - The debug information
   */
  [Events.FFMPEG_DEBUG]: (debug: string) => Awaitable;
  /**
   * @event
   * Emitted when there is no more song in the queue and {@link Queue#autoplay} is
   * `false`. DisTube will leave voice channel if {@link
   * DisTubeOptions}.leaveOnFinish is `true`.
   *
   * @example
   * ```ts
   * distube.on("finish", queue => queue.textChannel.send("No more song in queue"));
   * ```
   *
   * @param queue - The guild queue
   */
  [Events.FINISH]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when DisTube finished a song.
   *
   * @example
   * ```ts
   * distube.on("finishSong", (queue, song) => queue.textChannel.send(`${song.name} has finished!`));
   * ```
   *
   * @param queue - The guild queue
   * @param song  - Finished song
   */
  [Events.FINISH_SONG]: (queue: Queue, song: Song) => Awaitable;
  /**
   * @event
   * Emitted when DisTube initialize a queue to change queue default properties.
   *
   * @example
   * ```ts
   * distube.on("initQueue", queue => {
   *     queue.autoplay = false;
   *     queue.volume = 100;
   * });
   * ```ts
   *
   * @param queue - The guild queue
   */
  [Events.INIT_QUEUE]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when {@link Queue#autoplay} is `true`, {@link Queue#songs} is empty, and
   * DisTube cannot find related songs to play.
   *
   * @example
   * ```ts
   * distube.on("noRelated", queue => queue.textChannel.send("Can't find related video to play."));
   * ```ts
   *
   * @param queue - The guild queue
   */
  [Events.NO_RELATED]: (queue: Queue) => Awaitable;
  /**
   * @event
   * Emitted when DisTube play a song.
   *
   * If {@link DisTubeOptions}.emitNewSongOnly is `true`, this event is not emitted
   * when looping a song or next song is the previous one.
   *
   * @example
   * ```ts
   * distube.on("playSong", (queue, song) => queue.textChannel.send(
   *     `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}`
   * ));
   * ```ts
   *
   * @param queue - The guild queue
   * @param song  - Playing song
   */
  [Events.PLAY_SONG]: (queue: Queue, song: Song) => Awaitable;
}

/**
 * DisTube class
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class DisTube extends TypedEmitter<TypedDisTubeEvents> {
  readonly handler: DisTubeHandler;
  readonly options: Options;
  readonly client: Client;
  readonly queues: QueueManager;
  readonly voices: DisTubeVoiceManager;
  readonly extractorPlugins: ExtractorPlugin[];
  readonly filters: Filters;
  /**
   * Create a new DisTube class.
   *
   * @example
   * ```ts
   * const Discord = require('discord.js'),
   *     DisTube = require('distube'),
   *     client = new Discord.Client();
   * // Create a new DisTube
   * const distube = new DisTube.default(client, { searchSongs: 10 });
   * // client.DisTube = distube // make it access easily
   * client.login("Your Discord Bot Token")
   * ```ts
   *
   * @throws {@link DisTubeError}
   *
   * @param client - Discord.JS client
   * @param opts   - Custom DisTube options
   */
  constructor(client: Client, opts: DisTubeOptions = {}) {
    super();
    this.setMaxListeners(1);
    if (!isClientInstance(client)) throw new DisTubeError("INVALID_TYPE", "Discord.Client", client, "client");
    /**
     * Discord.JS client
     */
    this.client = client;
    checkIntents(client.options);
    /**
     * DisTube options
     */
    this.options = new Options(opts);
    /**
     * Voice connections manager
     */
    this.voices = new DisTubeVoiceManager(this);
    /**
     * DisTube's Handler
     */
    this.handler = new DisTubeHandler(this);
    /**
     * Queues manager
     */
    this.queues = new QueueManager(this);
    /**
     * DisTube filters
     */
    this.filters = { ...defaultFilters, ...this.options.customFilters };
    // Default plugin
    if (this.options.directLink) this.options.plugins.push(new DirectLinkPlugin());
    this.options.plugins.forEach(p => p.init(this));
    /**
     * Extractor Plugins
     */
    this.extractorPlugins = this.options.plugins.filter((p): p is ExtractorPlugin => p.type === PluginType.EXTRACTOR);
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
   * Play / add a song or playlist from url. Search and play a song if it is not a
   * valid url.
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "play")
   *         distube.play(message.member.voice.channel, args.join(" "), {
   *             member: message.member,
   *             textChannel: message.channel,
   *             message
   *         });
   * });
   * ```ts
   *
   * @throws {@link DisTubeError}
   *
   * @param voiceChannel - The channel will be joined if the bot isn't in any channels, the bot will be
   *                       moved to this channel if {@link DisTubeOptions}.joinNewVoiceChannel is `true`
   * @param song         - URL | Search string | {@link Song} | {@link Playlist}
   * @param options      - Optional options
   */
  async play(
    voiceChannel: VoiceBasedChannel,
    song: string | Song | Playlist,
    options: PlayOptions = {},
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

    const queue = this.getQueue(voiceChannel);
    const queuing = queue && !queue._taskQueue.hasResolveTask;
    if (queuing) await queue?._taskQueue.queuing(true);
    try {
      // TODO: new search plugin
      song = await this.handler.resolve(song, { member, metadata });
      if (song instanceof Playlist) {
        await this.handler.playPlaylist(voiceChannel, song, { textChannel, skip, position });
      } else {
        await this.handler.playSong(voiceChannel, song, { textChannel, skip, position });
      }
    } catch (e: any) {
      if (!(e instanceof DisTubeError)) {
        try {
          e.name = "PlayError";
          e.message = `${typeof song === "string" ? song : song.url}\n${e.message}`;
        } catch {
          // Throw original error
        }
      }
      throw e;
    } finally {
      if (queuing) queue?._taskQueue.resolve();
    }
  }

  /**
   * Create a custom playlist
   *
   * @example
   * ```ts
   * const songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
   * const playlist = await distube.createCustomPlaylist(songs, {
   *     member: message.member,
   *     properties: { name: "My playlist name", source: "custom" },
   *     parallel: true
   * });
   * distube.play(voiceChannel, playlist, { ... });
   * ```ts
   *
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
        thumbnail,
        songs: resolvedSongs,
      },
      { member, metadata },
    );
  }

  /**
   * Get the guild queue
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "queue") {
   *         const queue = distube.getQueue(message);
   *         message.channel.send('Current queue:\n' + queue.songs.map((song, id) =>
   *             `**${id+1}**. [${song.name}](${song.url}) - \`${song.formattedDuration}\``
   *         ).join("\n"));
   *     }
   * });
   * ```ts
   *
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
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   *
   * @returns The guild queue
   */
  pause(guild: GuildIdResolvable): Queue {
    return this.#getQueue(guild).pause();
  }

  /**
   * Resume the guild stream
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   *
   * @returns The guild queue
   */
  resume(guild: GuildIdResolvable): Queue {
    return this.#getQueue(guild).resume();
  }

  /**
   * Stop the guild stream
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "stop") {
   *         distube.stop(message);
   *         message.channel.send("Stopped the queue!");
   *     }
   * });
   * ```ts
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   */
  stop(guild: GuildIdResolvable): Promise<void> {
    return this.#getQueue(guild).stop();
  }

  /**
   * Set the guild stream's volume
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "volume")
   *         distube.setVolume(message, Number(args[0]));
   * });
   * ```ts
   *
   * @param guild   - The type can be resolved to give a {@link Queue}
   * @param percent - The percentage of volume you want to set
   *
   * @returns The guild queue
   */
  setVolume(guild: GuildIdResolvable, percent: number): Queue {
    return this.#getQueue(guild).setVolume(percent);
  }

  /**
   * Skip the playing song if there is a next song in the queue. <info>If {@link
   * Queue#autoplay} is `true` and there is no up next song, DisTube will add and
   * play a related song.</info>
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "skip")
   *         distube.skip(message);
   * });
   * ```ts
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   *
   * @returns The new Song will be played
   */
  skip(guild: GuildIdResolvable): Promise<Song> {
    return this.#getQueue(guild).skip();
  }

  /**
   * Play the previous song
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "previous")
   *         distube.previous(message);
   * });
   * ```ts
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   *
   * @returns The new Song will be played
   */
  previous(guild: GuildIdResolvable): Promise<Song> {
    return this.#getQueue(guild).previous();
  }

  /**
   * Shuffle the guild queue songs
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "shuffle")
   *         distube.shuffle(message);
   * });
   * ```ts
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   *
   * @returns The guild queue
   */
  shuffle(guild: GuildIdResolvable): Promise<Queue> {
    return this.#getQueue(guild).shuffle();
  }

  /**
   * Jump to the song number in the queue. The next one is 1, 2,... The previous one
   * is -1, -2,...
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "jump")
   *         distube.jump(message, parseInt(args[0]))
   *             .catch(err => message.channel.send("Invalid song number."));
   * });
   * ```ts
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   * @param num   - The song number to play
   *
   * @returns The new Song will be played
   */
  jump(guild: GuildIdResolvable, num: number): Promise<Song> {
    return this.#getQueue(guild).jump(num);
  }

  /**
   * Set the repeat mode of the guild queue.
   * Toggle mode `(Disabled -> Song -> Queue -> Disabled ->...)` if `mode` is `undefined`
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "repeat") {
   *         let mode = distube.setRepeatMode(message, parseInt(args[0]));
   *         mode = mode ? mode == 2 ? "Repeat queue" : "Repeat song" : "Off";
   *         message.channel.send("Set repeat mode to `" + mode + "`");
   *     }
   * });
   * ```ts
   * @example
   * ```ts
   * const { RepeatMode } = require("distube");
   * let mode;
   * switch(distube.setRepeatMode(message, parseInt(args[0]))) {
   *     case RepeatMode.DISABLED:
   *         mode = "Off";
   *         break;
   *     case RepeatMode.SONG:
   *         mode = "Repeat a song";
   *         break;
   *     case RepeatMode.QUEUE:
   *         mode = "Repeat all queue";
   *         break;
   * }
   * message.channel.send("Set repeat mode to `" + mode + "`");
   * ```ts
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   * @param mode  - The repeat modes (toggle if `undefined`)
   *
   * @returns The new repeat mode
   */
  setRepeatMode(guild: GuildIdResolvable, mode?: number): number {
    return this.#getQueue(guild).setRepeatMode(mode);
  }

  /**
   * Toggle autoplay mode
   *
   * @example
   * ```ts
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "autoplay") {
   *         const mode = distube.toggleAutoplay(message);
   *         message.channel.send("Set autoplay mode to `" + (mode ? "On" : "Off") + "`");
   *     }
   * });
   * ```ts
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   *
   * @returns Autoplay mode state
   */
  toggleAutoplay(guild: GuildIdResolvable): boolean {
    const queue = this.#getQueue(guild);
    queue.autoplay = !queue.autoplay;
    return queue.autoplay;
  }

  /**
   * Add related song to the queue
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   *
   * @returns The guild queue
   */
  addRelatedSong(guild: GuildIdResolvable): Promise<Song> {
    return this.#getQueue(guild).addRelatedSong();
  }

  /**
   * Set the playing time to another position
   *
   * @example
   * ```ts
   * client.on('message', message => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command = 'seek')
   *         distube.seek(message, Number(args[0]));
   * });
   * ```ts
   *
   * @param guild - The type can be resolved to give a {@link Queue}
   * @param time  - Time in seconds
   *
   * @returns Seeked queue
   */
  seek(guild: GuildIdResolvable, time: number): Queue {
    return this.#getQueue(guild).seek(time);
  }

  /**
   * Emit error event
   *
   * @param error   - error
   * @param channel - Text channel where the error is encountered.
   */
  emitError(error: Error, channel?: GuildTextBasedChannel): void {
    if (this.listeners(Events.ERROR).length) {
      this.emit(Events.ERROR, channel, error);
    } else {
      /* eslint-disable no-console */
      console.error(error);
      console.warn("Unhandled 'error' event.");
      console.warn(
        "See: https://distube.js.org/classes/DisTube.html#error and https://nodejs.org/api/events.html#events_error_events",
      );
      /* eslint-enable no-console */
    }
  }
}

export default DisTube;
