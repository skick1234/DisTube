import ytpl from "@distube/ytpl";
import ytsr from "@distube/ytsr";
import { checkIntents, isURL } from "./util";
import { TypedEmitter } from "tiny-typed-emitter";
import {
  DisTubeError,
  DisTubeHandler,
  DisTubeVoiceManager,
  HTTPPlugin,
  HTTPSPlugin,
  Options,
  Playlist,
  Queue,
  QueueManager,
  SearchResult,
  Song,
  YouTubeDLPlugin,
  defaultFilters,
  isClientInstance,
  isMemberInstance,
  isMessageInstance,
  isSupportedVoiceChannel,
  isTextChannelInstance,
} from ".";
import type { Client, GuildMember, GuildTextBasedChannel, Message, TextChannel, VoiceBasedChannel } from "discord.js";
import type { CustomPlugin, DisTubeEvents, DisTubeOptions, ExtractorPlugin, Filters, GuildIdResolvable } from ".";

// Cannot be `import` as it's not under TS root dir
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
export const { version }: { version: string } = require("../package.json");

/**
 * DisTube class
 * @extends EventEmitter
 */
export class DisTube extends TypedEmitter<DisTubeEvents> {
  readonly handler: DisTubeHandler;
  readonly options: Options;
  readonly client: Client;
  readonly queues: QueueManager;
  readonly voices: DisTubeVoiceManager;
  readonly extractorPlugins: ExtractorPlugin[];
  readonly customPlugins: CustomPlugin[];
  readonly filters: Filters;
  /**
   * Create a new DisTube class.
   * @param {Discord.Client} client Discord.JS client
   * @param {DisTubeOptions} [otp] Custom DisTube options
   * @example
   * const Discord = require('discord.js'),
   *     DisTube = require('distube'),
   *     client = new Discord.Client();
   * // Create a new DisTube
   * const distube = new DisTube.default(client, { searchSongs: 10 });
   * // client.DisTube = distube // make it access easily
   * client.login("Your Discord Bot Token")
   */
  constructor(client: Client, otp: DisTubeOptions = {}) {
    super();
    this.setMaxListeners(1);
    if (!isClientInstance(client)) throw new DisTubeError("INVALID_TYPE", "Discord.Client", client, "client");
    /**
     * Discord.JS client
     * @type {Discord.Client}
     */
    this.client = client;
    checkIntents(client.options);
    /**
     * DisTube options
     * @type {DisTubeOptions}
     */
    this.options = new Options(otp);
    /**
     * Voice connections manager
     * @type {DisTubeVoiceManager}
     */
    this.voices = new DisTubeVoiceManager(this);
    /**
     * DisTube's Handler
     * @type {DisTubeHandler}
     * @private
     */
    this.handler = new DisTubeHandler(this);
    /**
     * Queues manager
     * @type {QueueManager}
     */
    this.queues = new QueueManager(this);
    /**
     * DisTube filters
     * @type {Filters}
     */
    this.filters = defaultFilters;
    Object.assign(this.filters, this.options.customFilters);
    // Default plugin
    this.options.plugins.push(new HTTPPlugin(), new HTTPSPlugin());
    if (this.options.youtubeDL) this.options.plugins.push(new YouTubeDLPlugin(this.options.updateYouTubeDL));
    this.options.plugins.map(p => p.init(this));
    /**
     * Extractor Plugins
     * @type {ExtractorPlugin[]}
     * @private
     */
    this.extractorPlugins = this.options.plugins.filter((p): p is ExtractorPlugin => p.type === "extractor");
    /**
     * Custom Plugins
     * @type {CustomPlugin[]}
     * @private
     */
    this.customPlugins = this.options.plugins.filter((p): p is CustomPlugin => p.type === "custom");
  }

  static get version() {
    return version;
  }

  /**
   * DisTube version
   * @type {string}
   */
  get version() {
    return version;
  }

  /**
   * Play / add a song or playlist from url. Search and play a song if it is not a valid url.
   *
   * @param {Discord.BaseGuildVoiceChannel} voiceChannel The voice channel will be joined
   * @param {string|Song|SearchResult|Playlist} song URL | Search string |
   * {@link Song} | {@link SearchResult} | {@link Playlist}
   * @param {Object} [options] Optional options
   * @param {boolean} [options.skip=false] Skip the playing song (if exists) and play the added song/playlist instantly
   * @param {boolean} [options.unshift=false] Add the song/playlist to the beginning of the queue
   * (after the playing song if exists)
   * @param {Discord.GuildMember} [options.member] Requested user (default is your bot)
   * @param {Discord.BaseGuildTextChannel} [options.textChannel] Default {@link Queue#textChannel}
   * @param {Discord.Message} [options.message] Called message (For built-in search events. If this is a {@link https://developer.mozilla.org/en-US/docs/Glossary/Falsy|falsy value}, it will play the first result instead)
   * @param {*} [options.metadata] Optional metadata that can be attached to the song/playlist will be played,
   * This is useful for identification purposes when the song/playlist is passed around in events.
   * See {@link Song#metadata} or {@link Playlist#metadata}
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "play")
   *         distube.play(message.member.voice?.channel, args.join(" "), {
   *             member: message.member,
   *             textChannel: message.channel,
   *             message
   *         });
   * });
   * @returns {Promise<void>}
   */
  async play(
    voiceChannel: VoiceBasedChannel,
    song: string | Song | SearchResult | Playlist | null,
    options: {
      skip?: boolean;
      unshift?: boolean;
      member?: GuildMember;
      textChannel?: GuildTextBasedChannel;
      message?: Message;
      metadata?: any;
    } = {},
  ): Promise<void> {
    if (!isSupportedVoiceChannel(voiceChannel)) {
      throw new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", voiceChannel, "voiceChannel");
    }
    if (typeof options !== "object" || Array.isArray(options)) {
      throw new DisTubeError("INVALID_TYPE", "object", options, "options");
    }
    const { textChannel, member, skip, message, unshift, metadata } = Object.assign(
      {
        member: voiceChannel.guild.me,
        skip: false,
        unshift: false,
      },
      options,
    );
    if (message && !isMessageInstance(message)) {
      throw new DisTubeError("INVALID_TYPE", ["Discord.Message", "a falsy value"], message, "options.message");
    }
    try {
      if (typeof song === "string") {
        for (const plugin of this.customPlugins) {
          if (await plugin.validate(song)) {
            return plugin.play(voiceChannel, song, options);
          }
        }
      }
      let queue = this.getQueue(voiceChannel);
      const queuing = !!queue && !queue.taskQueue.hasResolveTask;
      if (queuing) await queue?.taskQueue.queuing(true);
      try {
        if (song instanceof SearchResult && song.type === "playlist") song = song.url;
        if (typeof song === "string" && ytpl.validateID(song)) {
          song = await this.handler.resolvePlaylist(song, { member, metadata });
        }
        if (typeof song === "string" && !isURL(song)) {
          if (!message) song = (await this.search(song, { limit: 1 }))[0];
          else song = await this.handler.searchSong(message, song);
        }
        song = await this.handler.resolveSong(song, { member, metadata });
        if (!song) return;
        if (song instanceof Playlist) {
          await this.handler.handlePlaylist(voiceChannel, song, { textChannel, skip, unshift });
        } else if (!this.options.nsfw && song.age_restricted && !(textChannel as TextChannel)?.nsfw) {
          throw new DisTubeError("NON_NSFW");
        } else {
          queue = this.getQueue(voiceChannel);
          if (queue) {
            queue.addToQueue(song, skip || unshift ? 1 : -1);
            if (skip) queue.skip();
            else this.emit("addSong", queue, song);
          } else {
            const newQueue = await this.queues.create(voiceChannel, song, textChannel);
            if (newQueue instanceof Queue) {
              if (this.options.emitAddSongWhenCreatingQueue) this.emit("addSong", newQueue, song);
              this.emit("playSong", newQueue, song);
            }
          }
        }
      } finally {
        if (queuing) queue?.taskQueue.resolve();
      }
    } catch (e: any) {
      if (!(e instanceof DisTubeError)) {
        try {
          e.name = "PlayError";
          e.message = `${(song as Song)?.url || song}\n${e.message}`;
        } catch {}
      }
      this.emitError(e, textChannel);
    }
  }

  /**
   * Create a custom playlist
   * @returns {Promise<Playlist>}
   * @param {Array<string|Song|SearchResult>} songs Array of url, Song or SearchResult
   * @param {Object} [options] Optional options
   * @param {Discord.GuildMember} [options.message] A message from guild channel | A guild member
   * @param {Object} [options.properties={}] Additional properties such as `name`
   * @param {boolean} [options.parallel=true] Whether or not fetch the songs in parallel
   * @param {*} [options.metadata] Metadata
   * @example
   * const songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
   * const playlist = await distube.createCustomPlaylist(songs, {
   *     member: message.member,
   *     properties: { name: "My playlist name" },
   *     parallel: true
   * });
   * distube.play(voiceChannel, playlist, { ... });
   */
  async createCustomPlaylist(
    songs: (string | Song | SearchResult)[],
    options: {
      member?: GuildMember;
      properties?: Record<string, any>;
      parallel?: boolean;
      metadata?: any;
    } = {},
  ): Promise<Playlist> {
    const { member, properties, parallel, metadata } = Object.assign({ parallel: true }, options);
    if (!Array.isArray(songs)) throw new DisTubeError("INVALID_TYPE", "Array", songs, "songs");
    if (!songs.length) throw new DisTubeError("EMPTY_ARRAY", "songs");
    const filteredSongs = songs.filter(
      song => song instanceof Song || (song instanceof SearchResult && song.type === "video") || isURL(song),
    );
    if (!filteredSongs.length) throw new DisTubeError("NO_VALID_SONG");
    if (member && !isMemberInstance(member)) {
      throw new DisTubeError("INVALID_TYPE", "Discord.Member", member, "options.member");
    }
    if (!filteredSongs.length) throw new DisTubeError("NO_VALID_SONG");
    let resolvedSongs: Song[];
    if (parallel) {
      const promises = filteredSongs.map((song: string | Song | SearchResult) =>
        this.handler.resolveSong(song, { member, metadata }).catch(() => undefined),
      );
      resolvedSongs = (await Promise.all(promises)).filter((s: any): s is Song => !!s);
    } else {
      const resolved = [];
      for (const song of filteredSongs) {
        resolved.push(await this.handler.resolveSong(song, { member, metadata }).catch(() => undefined));
      }
      resolvedSongs = resolved.filter((s: any): s is Song => !!s);
    }
    return new Playlist(resolvedSongs, { member, properties, metadata });
  }

  /**
   * Search for a song. You can customize how user answers instead of send a number.
   * Then use {@link DisTube#play} to play it.
   *
   * @param {string} string The string search for
   * @param {Object} options Search options
   * @param {number} [options.limit=10] Limit the results
   * @param {'video'|'playlist'} [options.type='video'] Type of results (`video` or `playlist`).
   * @param {boolean} [options.safeSearch=false] Whether or not use safe search (YouTube restricted mode)
   * @throws {Error}
   * @returns {Promise<Array<SearchResult>>} Array of results
   */
  async search(
    string: string,
    options: { type?: "video" | "playlist"; limit?: number; safeSearch?: boolean; retried?: boolean } = {},
  ): Promise<Array<SearchResult>> {
    const opts = Object.assign({ type: "video", limit: 10, safeSearch: false }, options);
    if (typeof opts.type !== "string" || !["video", "playlist"].includes(opts.type)) {
      throw new DisTubeError("INVALID_TYPE", ["video", "playlist"], opts.type, "options.type");
    }
    if (typeof opts.limit !== "number") throw new DisTubeError("INVALID_TYPE", "number", opts.limit, "options.limit");
    if (opts.limit < 1) throw new DisTubeError("NUMBER_COMPARE", "option.limit", "bigger or equal to", 1);
    if (typeof opts.safeSearch !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", opts.safeSearch, "options.safeSearch");
    }

    try {
      const search = await ytsr(string, opts);
      const results = search.items.map(i => new SearchResult(i));
      if (results.length === 0) throw new DisTubeError("NO_RESULT");
      return results;
    } catch (e) {
      if (options.retried) throw e;
      options.retried = true;
      return this.search(string, options);
    }
  }

  /**
   * Get the guild queue
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Queue?}
   * @throws {Error}
   * @example
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
   */
  getQueue(queue: GuildIdResolvable): Queue | undefined {
    return this.queues.get(queue);
  }

  /**
   * Pause the guild stream
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Queue} The guild queue
   * @throws {Error}
   */
  pause(queue: GuildIdResolvable): Queue {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.pause();
  }

  /**
   * Resume the guild stream
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Queue} The guild queue
   * @throws {Error}
   */
  resume(queue: GuildIdResolvable): Queue {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.resume();
  }

  /**
   * Stop the guild stream
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Promise<void>}
   * @throws {Error}
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "stop") {
   *         distube.stop(message);
   *         message.channel.send("Stopped the queue!");
   *     }
   * });
   */
  stop(queue: GuildIdResolvable): Promise<void> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.stop();
  }

  /**
   * Set the guild stream's volume
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @param {number} percent The percentage of volume you want to set
   * @returns {Queue} The guild queue
   * @throws {Error}
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "volume")
   *         distube.setVolume(message, Number(args[0]));
   * });
   */
  setVolume(queue: GuildIdResolvable, percent: number): Queue {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.setVolume(percent);
  }

  /**
   * Skip the playing song if there is a next song in the queue.
   * <info>If {@link Queue#autoplay} is `true` and there is no up next song,
   * DisTube will add and play a related song.</info>
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Promise<Song>} The new Song will be played
   * @throws {Error}
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "skip")
   *         distube.skip(message);
   * });
   */
  skip(queue: GuildIdResolvable): Promise<Song> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.skip();
  }

  /**
   * Play the previous song
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Promise<Song>} The new Song will be played
   * @throws {Error}
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "previous")
   *         distube.previous(message);
   * });
   */
  previous(queue: GuildIdResolvable): Promise<Song> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.previous();
  }

  /**
   * Shuffle the guild queue songs
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Promise<Queue>} The guild queue
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "shuffle")
   *         distube.shuffle(message);
   * });
   */
  shuffle(queue: GuildIdResolvable): Promise<Queue> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.shuffle();
  }

  /**
   * Jump to the song number in the queue.
   * The next one is 1, 2,...
   * The previous one is -1, -2,...
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @param {number} num The song number to play
   * @returns {Promise<Queue>} The guild queue
   * @throws {Error} if `num` is invalid number (0 < num < {@link Queue#songs}.length)
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "jump")
   *         distube.jump(message, parseInt(args[0]))
   *             .catch(err => message.channel.send("Invalid song number."));
   * });
   */
  jump(queue: GuildIdResolvable, num: number): Promise<Queue> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.jump(num);
  }

  /**
   * Set the repeat mode of the guild queue.\
   * Toggle mode `(Disabled -> Song -> Queue -> Disabled ->...)` if `mode` is `undefined`
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @param {RepeatMode?} [mode] The repeat modes (toggle if `undefined`)
   * @returns {RepeatMode} The new repeat mode
   * @example
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
   * @example
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
   */
  setRepeatMode(queue: GuildIdResolvable, mode?: number): number {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.setRepeatMode(mode);
  }

  /**
   * Toggle autoplay mode
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {boolean} Autoplay mode state
   * @throws {Error}
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "autoplay") {
   *         const mode = distube.toggleAutoplay(message);
   *         message.channel.send("Set autoplay mode to `" + (mode ? "On" : "Off") + "`");
   *     }
   * });
   */
  toggleAutoplay(queue: GuildIdResolvable): boolean {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    q.autoplay = !q.autoplay;
    return q.autoplay;
  }

  /**
   * Add related song to the queue
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Promise<Song>} The guild queue
   */
  addRelatedSong(queue: GuildIdResolvable): Promise<Song> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.addRelatedSong();
  }

  /**
   * Enable or disable filter(s) of the queue.
   * Available filters: {@link Filters}
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @param {string|false} filter A filter name, `false` to clear all the filters
   * @param {boolean} [force=false] Force enable the input filter(s) even if it's enabled
   * @returns {Array<string>} Enabled filters.
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if ([`3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`].includes(command)) {
   *         const filter = distube.setFilter(message, command);
   *         message.channel.send("Current queue filter: " + (filter.join(", ") || "Off"));
   *     }
   * });
   */
  setFilter(queue: GuildIdResolvable, filter: string | false, force = false): Array<string> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.setFilter(filter, force);
  }

  /**
   * Set the playing time to another position
   * @param {GuildIdResolvable} queue The type can be resolved to give a {@link Queue}
   * @param {number} time Time in seconds
   * @returns {Queue} Seeked queue
   * @example
   * client.on('message', message => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command = 'seek')
   *         distube.seek(message, Number(args[0]));
   * });
   */
  seek(queue: GuildIdResolvable, time: number): Queue {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.seek(time);
  }

  /* eslint-disable no-console */
  /**
   * Emit error event
   * @param {Error} error error
   * @param {Discord.BaseGuildTextChannel} [channel] Text channel where the error is encountered.
   * @private
   */
  emitError(error: Error, channel?: GuildTextBasedChannel): void {
    if (!channel || !isTextChannelInstance(channel)) {
      console.error(error);
      console.warn("This is logged because <Queue>.textChannel is undefined");
    } else if (this.listeners("error").length) {
      this.emit("error", channel, error);
    } else {
      console.error(error);
      console.warn("Unhandled 'error' event.");
      console.warn(
        "See: https://distube.js.org/#/docs/DisTube/stable/class/DisTube?scrollTo=e-error and https://nodejs.org/api/events.html#events_error_events",
      );
    }
  }
  /* eslint-enable no-console */
}

export default DisTube;

/**
 * Emitted after DisTube add a new playlist to the playing {@link Queue}.
 *
 * @event DisTube#addList
 * @param {Queue} queue The guild queue
 * @param {Playlist} playlist Playlist info
 * @example
 * distube.on("addList", (queue, playlist) => queue.textChannel.send(
 *     `Added \`${playlist.name}\` playlist (${playlist.songs.length} songs) to the queue!`
 * ));
 */

/**
 * Emitted after DisTube add a new song to the playing {@link Queue}.
 *
 * @event DisTube#addSong
 * @param {Queue} queue The guild queue
 * @param {Song} song Added song
 * @example
 * distube.on("addSong", (queue, song) => queue.textChannel.send(
 *     `Added ${song.name} - \`${song.formattedDuration}\` to the queue by ${song.user}.`
 * ));
 */

/**
 * Emitted when there is no user in the voice channel,
 * {@link DisTubeOptions}.leaveOnEmpty is `true` and there is a playing queue.
 *
 * If there is no playing queue (stopped and {@link DisTubeOptions}.leaveOnStop is `false`),
 * it will leave the channel without emitting this event.
 * @event DisTube#empty
 * @param {Queue} queue The guild queue
 * @example
 * distube.on("empty", queue => queue.textChannel.send("Channel is empty. Leaving the channel"))
 */

/**
 * Emitted when DisTube encounters an error.
 *
 * @event DisTube#error
 * @param {Discord.BaseGuildTextChannel} channel Text channel where the error is encountered.
 * @param {Error} error The error encountered
 * @example
 * distube.on("error", (channel, error) => channel.send(
 *     "An error encountered: " + error
 * ));
 */

/**
 * Emitted when there is no more song in the queue and {@link Queue#autoplay} is `false`.
 * DisTube will leave voice channel if {@link DisTubeOptions}.leaveOnFinish is `true`.
 *
 * @event DisTube#finish
 * @param {Queue} queue The guild queue
 * @example
 * distube.on("finish", queue => queue.textChannel.send("No more song in queue"));
 */

/**
 * Emitted when DisTube initialize a queue to change queue default properties.
 *
 * @event DisTube#initQueue
 * @param {Queue} queue The guild queue
 * @example
 * distube.on("initQueue", queue => {
 *     queue.autoplay = false;
 *     queue.volume = 100;
 * });
 */

/**
 * Emitted when {@link Queue#autoplay} is `true`, {@link Queue#songs} is empty,
 * and DisTube cannot find related songs to play.
 *
 * @event DisTube#noRelated
 * @param {Queue} queue The guild queue
 * @example
 * distube.on("noRelated", queue => queue.textChannel.send("Can't find related video to play."));
 */

/**
 * Emitted when DisTube play a song.
 *
 * If {@link DisTubeOptions}.emitNewSongOnly is `true`,
 * this event is not emitted when looping a song or next song is the previous one.
 *
 * @event DisTube#playSong
 * @param {Queue} queue The guild queue
 * @param {Song} song Playing song
 * @example
 * distube.on("playSong", (queue, song) => queue.textChannel.send(
 *     `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}`
 * ));
 */

/**
 * Emitted when DisTube cannot find any results for the query.
 *
 * @event DisTube#searchNoResult
 * @param {Discord.Message} message The user message called play method
 * @param {string} query The search query
 * @example
 * distube.on("searchNoResult", (message, query) => message.channel.send(`No result found for ${query}!`));
 */

/**
 * Emitted when {@link DisTubeOptions|DisTubeOptions.searchSongs} bigger than 0,
 * and song param of {@link DisTube#play} is invalid url.
 * DisTube will wait for user's next message to choose a song manually.
 * <info>{@link https://support.google.com/youtube/answer/7354993|Safe search} is enabled
 * if {@link DisTubeOptions}.nsfw is disabled and the message's channel is not a nsfw channel.</info>
 *
 * @event DisTube#searchResult
 * @param {Discord.Message} message The user message called play method
 * @param {Array<SearchResult>} results Searched results
 * @param {string} query The search query
 * @example
 * // DisTubeOptions.searchSongs > 0
 * distube.on("searchResult", (message, results) => {
 *     message.channel.send(`**Choose an option from below**\n${
 *         results.map((song, i) => `**${i + 1}**. ${song.name} - \`${song.formattedDuration}\``).join("\n")
 *     }\n*Enter anything else or wait 60 seconds to cancel*`);
 * });
 */

/**
 * Emitted when {@link DisTubeOptions|DisTubeOptions.searchSongs} bigger than 0,
 * and the search canceled due to {@link DisTubeOptions|DisTubeOptions.searchTimeout}.
 *
 * @event DisTube#searchCancel
 * @param {Discord.Message} message The user message called play method
 * @param {string} query The search query
 * @example
 * // DisTubeOptions.searchSongs > 0
 * distube.on("searchCancel", (message) => message.channel.send(`Searching canceled`));
 */

/**
 * Emitted when {@link DisTubeOptions|DisTubeOptions.searchSongs} bigger than 0,
 * and the search canceled due to user's next message is not a number or out of results range.
 *
 * @event DisTube#searchInvalidAnswer
 * @param {Discord.Message} message The user message called play method
 * @param {Discord.Message} answer The answered message of user
 * @param {string} query The search query
 * @example
 * // DisTubeOptions.searchSongs > 0
 * distube.on("searchInvalidAnswer", (message) => message.channel.send(`You answered an invalid number!`));
 */

/**
 * Emitted when {@link DisTubeOptions|DisTubeOptions.searchSongs} bigger than 0,
 * and after the user chose a search result to play.
 *
 * @event DisTube#searchDone
 * @param {Discord.Message} message The user message called play method
 * @param {Discord.Message} answer The answered message of user
 * @param {string} query The search query
 */

/**
 * Emitted when the bot is disconnected to a voice channel.
 *
 * @event DisTube#disconnect
 * @param {Queue} queue The guild queue
 */

/**
 * Emitted when a {@link Queue} is deleted with any reasons.
 *
 * @event DisTube#deleteQueue
 * @param {Queue} queue The guild queue
 */

/**
 * Emitted when DisTube finished a song.
 *
 * @event DisTube#finishSong
 * @param {Queue} queue The guild queue
 * @param {Song} song Finished song
 */
