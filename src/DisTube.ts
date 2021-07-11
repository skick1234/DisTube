import ytpl from "@distube/ytpl";
import ytsr from "@distube/ytsr";
import { EventEmitter } from "events";
import { checkIntents, isURL, isVoiceChannelEmpty } from "./util";
import { Client, GuildMember, Message, StageChannel, TextChannel, VoiceChannel } from "discord.js";
import {
  CustomPlugin,
  DisTubeError,
  DisTubeHandler,
  DisTubeOptions,
  DisTubeVoiceManager,
  ExtractorPlugin,
  Filters,
  HTTPPlugin,
  HTTPSPlugin,
  Options,
  Playlist,
  Queue,
  QueueManager,
  QueueResolvable,
  SearchResult,
  Song,
  YouTubeDLPlugin,
  defaultFilters,
  isMessageInstance,
  isSupportedVoiceChannel,
  isTextChannelInstance,
} from ".";

export declare interface DisTube {
  handler: DisTubeHandler;
  options: Options;
  client: Client;
  queues: QueueManager;
  voices: DisTubeVoiceManager;
  extractorPlugins: ExtractorPlugin[];
  customPlugins: CustomPlugin[];
  filters: Filters;
  on(event: "addList", listener: (queue: Queue, playlist: Playlist) => void): this;
  on(event: "addSong" | "playSong" | "finishSong", listener: (queue: Queue, song: Song) => void): this;
  on(
    event: "empty" | "finish" | "initQueue" | "noRelated" | "disconnect" | "deleteQueue",
    listener: (queue: Queue) => void,
  ): this;
  on(event: "error", listener: (channel: TextChannel, error: Error) => void): this;
  on(event: "searchNoResult" | "searchCancel", listener: (message: Message, query: string) => void): this;
  on(event: "searchResult", listener: (message: Message, results: SearchResult[], query: string) => void): this;
  on(
    event: "searchInvalidAnswer" | "searchDone",
    listener: (message: Message, answer: Message, query: string) => void,
  ): this;
}
/**
 * DisTube class
 * @extends EventEmitter
 */
export class DisTube extends EventEmitter {
  /**
   * Create a new DisTube class.
   * @param {Discord.Client} client JS client
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
    if (!(client instanceof Client)) throw new DisTubeError("INVALID_TYPE", "Discord.Client", client, "client");
    /**
     * Discord.JS client
     * @type {Discord.Client}
     */
    this.client = client;
    checkIntents(client.options);
    /**
     * Voice connections manager
     * @type {DisTubeVoiceManager}
     */
    this.voices = new DisTubeVoiceManager(this);
    /**
     * DisTube options
     * @type {DisTubeOptions}
     */
    this.options = new Options(otp);
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
    if (typeof this.options.customFilters === "object") Object.assign(this.filters, this.options.customFilters);
    if (this.options.leaveOnEmpty) {
      client.on("voiceStateUpdate", oldState => {
        if (!oldState?.channel) return;
        const queue = this.getQueue(oldState);
        if (!queue) {
          if (isVoiceChannelEmpty(oldState)) {
            client.setTimeout(() => {
              const guildID = oldState.guild.id;
              if (!this.getQueue(oldState) && isVoiceChannelEmpty(oldState)) this.voices.leave(guildID);
            }, this.options.emptyCooldown * 1e3);
          }
          return;
        }
        if (queue.emptyTimeout) {
          client.clearTimeout(queue.emptyTimeout);
          delete queue.emptyTimeout;
        }
        if (isVoiceChannelEmpty(oldState)) {
          queue.emptyTimeout = client.setTimeout(() => {
            if (isVoiceChannelEmpty(oldState)) {
              queue.voice.leave();
              this.emit("empty", queue);
              queue.delete();
            }
          }, this.options.emptyCooldown * 1e3);
        }
      });
    }
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

  /**
   * Shorthand method for {@link DisTube#playVoiceChannel}
   * @returns {Promise<void>}
   * @param {Discord.Message} message A message from guild channel
   * @param {string|Song|SearchResult|Playlist} song YouTube url | Search string | {@link Song} | {@link SearchResult} | {@link Playlist}
   * @param {Object} [options] Optional options
   * @param {boolean} [options.skip=false] Skip the playing song (if exists) and play the added song/playlist instantly
   * @param {boolean} [options.unshift=false] Add the song/playlist to the beginning of the queue (after the playing song if exists)
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "play")
   *         distube.play(message, args.join(" "));
   * });
   */
  async play(
    message: Message,
    song: string | Song | SearchResult | Playlist,
    options: { skip?: boolean; unshift?: boolean } = {},
  ): Promise<void> {
    if (!song) return;
    if (!isMessageInstance(message)) throw new DisTubeError("INVALID_TYPE", "Discord.Message", message, "message");
    if (typeof options !== "object" || Array.isArray(options)) {
      throw new DisTubeError("INVALID_TYPE", "object", options, "options");
    }
    const textChannel = message.channel as TextChannel;
    const { skip, unshift } = Object.assign({ skip: false, unshift: false }, options);
    const member = message.member as GuildMember;
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) throw new DisTubeError("NOT_IN_VOICE");
    await this.playVoiceChannel(voiceChannel, song, {
      member,
      textChannel,
      skip,
      message,
      unshift,
    });
  }

  /**
   * Play / add a song or playlist from url. Search and play a song if it is not a valid url.
   * Emit {@link DisTube#addList}, {@link DisTube#addSong} or {@link DisTube#playSong} after executing
   * @returns {Promise<void>}
   * @param {Discord.VoiceChannel|Discord.StageChannel} voiceChannel The voice channel will be joined
   * @param {string|Song|SearchResult|Playlist} song YouTube url | Search string | {@link Song} | {@link SearchResult} | {@link Playlist}
   * @param {Object} [options] Optional options
   * @param {boolean} [options.skip=false] Skip the playing song (if exists) and play the added song/playlist instantly
   * @param {boolean} [options.unshift=false] Add the song/playlist to the beginning of the queue (after the playing song if exists)
   * @param {Discord.GuildMember} [options.member] Requested user (default is your bot)
   * @param {Discord.TextChannel} [options.textChannel=null] Default {@link Queue#textChannel} (if the queue wasn't created)
   * @param {Discord.Message} [options.message] Called message (For built-in search events. If this is a {@link https://developer.mozilla.org/en-US/docs/Glossary/Falsy|falsy value}, it will play the first result instead)
   */
  async playVoiceChannel(
    voiceChannel: VoiceChannel | StageChannel,
    song: string | Song | SearchResult | Playlist | null,
    options: {
      skip?: boolean;
      unshift?: boolean;
      member?: GuildMember;
      textChannel?: TextChannel;
      message?: Message;
    } = {},
  ): Promise<void> {
    if (!isSupportedVoiceChannel(voiceChannel)) throw new DisTubeError("NOT_SUPPORTED_VOICE");
    if (typeof options !== "object" || Array.isArray(options)) {
      throw new DisTubeError("INVALID_TYPE", "object", options, "options");
    }
    const { textChannel, member, skip, message, unshift } = Object.assign(
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
            return plugin.play(voiceChannel, song, member, textChannel as TextChannel, skip, unshift);
          }
        }
      }
      let queue = this.getQueue(voiceChannel);
      const queuing = queue && !queue.taskQueue.hasResolveTask;
      if (queuing) await queue?.taskQueue.queuing(true);
      try {
        if (song instanceof SearchResult && song.type === "playlist") song = song.url;
        if (typeof song === "string" && ytpl.validateID(song)) song = await this.handler.resolvePlaylist(member, song);
        if (typeof song === "string" && !isURL(song)) {
          if (!message) song = (await this.search(song, { limit: 1 }))[0];
          else song = await this.handler.searchSong(message, song);
        }
        song = await this.handler.resolveSong(member, song);
        if (!song) return;
        if (song instanceof Playlist) {
          await this.handler.handlePlaylist(voiceChannel, song, textChannel, skip, unshift);
        } else if (!this.options.nsfw && (song as Song).age_restricted && !textChannel?.nsfw) {
          throw new DisTubeError("NON_NSFW");
        } else {
          queue = this.getQueue(voiceChannel);
          if (queue) {
            queue.addToQueue(song as Song, skip || unshift ? 1 : -1);
            if (skip) queue.skip();
            else this.emit("addSong", queue, song);
          } else {
            const newQueue = await this.handler.createQueue(voiceChannel, song as Song, textChannel);
            if (newQueue instanceof Queue) this.emit("playSong", newQueue, song);
          }
        }
      } finally {
        if (queuing) queue?.taskQueue.resolve();
      }
    } catch (e) {
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
   * Play or add array of video urls.
   * {@link DisTube#event:playSong} or {@link DisTube#event:addList} will be emitted
   * with `playlist`'s properties include `properties` parameter's properties such as
   * `user`, `songs`, `duration`, `formattedDuration`, `thumbnail` like {@link Playlist}
   * @returns {Promise<void>}
   * @param {Discord.Message} message A message from guild channel
   * @param {Array<string|Song|SearchResult>} songs Array of url, Song or SearchResult
   * @param {Object} [properties={}] Additional properties such as `name`
   * @param {Object} [options] Optional options
   * @param {boolean} [options.skip=false] Skip the playing song (if exists) and play the added song/playlist instantly
   * @param {boolean} [options.unshift=false] Add the song/playlist to the beginning of the queue (after the playing song if exists)
   * @param {boolean} [options.parallel=true] Whether or not fetch the songs in parallel
   * @example
   *     let songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
   *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" });
   *     // Fetching custom playlist sequentially (reduce lag for low specs)
   *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" }, false, false);
   */
  async playCustomPlaylist(
    message: Message,
    songs: Array<string | Song | SearchResult>,
    properties: any = {},
    options: { skip?: boolean; unshift?: boolean; parallel?: boolean } = {},
  ): Promise<void> {
    try {
      if (typeof options !== "object" || Array.isArray(options)) {
        throw new DisTubeError("INVALID_TYPE", "object", options, "options");
      }
      const { skip, unshift, parallel } = Object.assign(
        {
          skip: false,
          unshift: false,
          parallel: true,
        },
        options,
      );
      const queue = this.getQueue(message);
      const queuing = queue && !queue.taskQueue.hasResolveTask;
      if (queuing) await queue?.taskQueue.queuing(true);
      try {
        const playlist = await this.handler.createCustomPlaylist(message, songs, properties, parallel);
        await this.handler.handlePlaylist(message, playlist, message.channel as TextChannel, skip, unshift);
      } finally {
        if (queuing) queue?.taskQueue.resolve();
      }
    } catch (e) {
      this.emitError(e, message.channel as TextChannel);
    }
  }

  /**
   * Search for a song.
   * You can customize how user answers instead of send a number.
   * Then use {@link DisTube#play} or {@link DisTube#playSkip} to play it.
   * @param {string} string The string search for
   * @param {Object} options Search options
   * @param {number} [options.limit=10] Limit the results
   * @param {'video'|'playlist'} [options.type='video'] Type of search (`video` or `playlist`).
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
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
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
  getQueue(queue: QueueResolvable): Queue | undefined {
    return this.queues.get(queue);
  }

  /**
   * Pause the guild stream
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Queue} The guild queue
   * @throws {Error}
   */
  pause(queue: QueueResolvable): Queue {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.pause();
  }

  /**
   * Resume the guild stream
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Queue} The guild queue
   * @throws {Error}
   */
  resume(queue: QueueResolvable): Queue {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.resume();
  }

  /**
   * Stop the guild stream
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
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
  stop(queue: QueueResolvable): Promise<void> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.stop();
  }

  /**
   * Set the guild stream's volume
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
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
  setVolume(queue: QueueResolvable, percent: number): Queue {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.setVolume(percent);
  }

  /**
   * Skip the playing song
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
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
  skip(queue: QueueResolvable): Promise<Song> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.skip();
  }

  /**
   * Play the previous song
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
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
  previous(queue: QueueResolvable): Promise<Song> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.previous();
  }

  /**
   * Shuffle the guild queue songs
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
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
  shuffle(queue: QueueResolvable): Promise<Queue> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.shuffle();
  }

  /**
   * Jump to the song number in the queue.
   * The next one is 1, 2,...
   * The previous one is -1, -2,...
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
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
  jump(queue: QueueResolvable, num: number): Promise<Queue> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.jump(num);
  }

  /**
   * Set the repeat mode of the guild queue.
   * Turn off if repeat mode is the same value as new mode.
   * Toggle mode `(0 -> 1 -> 2 -> 0...)`: `mode` is `undefined`
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
   * @param {number?} [mode] The repeat modes `(0: disabled, 1: Repeat a song, 2: Repeat all the queue)`
   * @returns {number} The new repeat mode
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
   */
  setRepeatMode(queue: QueueResolvable, mode?: number): number {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.setRepeatMode(mode);
  }

  /**
   * Toggle autoplay mode
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {boolean} Autoplay mode state
   * @throws {Error}
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "autoplay") {
   *         let mode = distube.toggleAutoplay(message);
   *         message.channel.send("Set autoplay mode to `" + (mode ? "On" : "Off") + "`");
   *     }
   * });
   */
  toggleAutoplay(queue: QueueResolvable): boolean {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    q.autoplay = !q.autoplay;
    return q.autoplay;
  }

  /**
   * Add related song to the queue
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
   * @returns {Promise<Song>} The guild queue
   */
  addRelatedSong(queue: QueueResolvable): Promise<Song> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.addRelatedSong();
  }

  /**
   * Enable or disable a filter of the queue.
   * Available filters: {@link Filters}
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
   * @param {string|false} filter A filter name, `false` to clear all the filters
   * @returns {Array<string>} Enabled filters.
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if ([`3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`].includes(command)) {
   *         let filter = distube.setFilter(message, command);
   *         message.channel.send("Current queue filter: " + (filter.join(", ") || "Off"));
   *     }
   * });
   */
  setFilter(queue: QueueResolvable, filter: string | false): Array<string> {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.setFilter(filter);
  }

  /**
   * Set the playing time to another position
   * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
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
  seek(queue: QueueResolvable, time: number): Queue {
    const q = this.getQueue(queue);
    if (!q) throw new DisTubeError("NO_QUEUE");
    return q.seek(time);
  }

  /* eslint-disable no-console */
  /**
   * Emit error event
   * @param {Error} error error
   * @param {Discord.TextChannel?} channel Text channel where the error is encountered.
   * @private
   */
  emitError(error: Error, channel?: TextChannel): void {
    if (!channel || !isTextChannelInstance(channel)) {
      console.error(error);
      console.warn("This is logged because <Queue>.textChannel is undefined");
    } else if (this.listeners("error").length) {
      this.emit("error", channel, error);
    } else {
      console.error(error);
      console.warn("Unhandled 'error' event.");
      console.warn(
        "See: https://distube.js.org/#/docs/DisTube/alpha/class/DisTube?scrollTo=e-error and https://nodejs.org/api/events.html#events_error_events",
      );
    }
  }
  /* eslint-enable no-console */
}

export default DisTube;

/**
 * Emitted after DisTube add a new playlist to the playing {@link Queue}
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
 *  Emitted after DisTube add a new song to the playing {@link Queue}
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
 * Emitted when there is no user in the voice channel, {@link DisTubeOptions}.leaveOnEmpty is `true` and there is a playing queue.
 * If there is no playing queue (stopped and {@link DisTubeOptions}.leaveOnStop is `false`), it will leave the channel without emitting this event.
 *
 * @event DisTube#empty
 * @param {Queue} queue The guild queue
 * @example
 * distube.on("empty", queue => queue.textChannel.send("Channel is empty. Leaving the channel"))
 */

/**
 * Emitted when {@link DisTube} encounters an error.
 *
 * @event DisTube#error
 * @param {Discord.TextChannel} channel Text channel where the error is encountered.
 * @param {Error} error The error encountered
 * @example
 * distube.on("error", (channel, error) => channel.send(
 *     "An error encountered: " + error
 * ));
 */

/**
 * Emitted when there is no more song in the queue and {@link Queue#autoplay} is `false`.
 * DisTube will leave voice channel if {@link DisTubeOptions}.leaveOnFinish is `true`
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
 * Emitted when {@link Queue#autoplay} is `true`, the {@link Queue#songs} is empty and
 * DisTube cannot find related songs to play
 *
 * @event DisTube#noRelated
 * @param {Queue} queue The guild queue
 * @example
 * distube.on("noRelated", queue => queue.textChannel.send("Can't find related video to play."));
 */

/**
 * Emitted when DisTube play a song.
 * If {@link DisTubeOptions}.emitNewSongOnly is `true`, event is not emitted when looping a song or next song is the previous one
 *
 * @event DisTube#playSong
 * @param {Queue} queue The guild queue
 * @param {Song} song Playing song
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("playSong", (queue, song) => queue.textChannel.send(
 *     `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}\n${status(queue)}`
 * ));
 */

/**
 * Emitted when DisTube cannot find any results for the query
 *
 * @event DisTube#searchNoResult
 * @param {Discord.Message} message The user message called play method
 * @param {string} query The search query
 * @example
 * distube.on("searchNoResult", (message, query) => message.channel.send(`No result found for ${query}!`));
 */

/**
 * Emitted when {@link DisTubeOptions|DisTubeOptions.searchSongs} bigger than 0
 * and song param of {@link DisTube#play|play()} is invalid url.
 * DisTube will wait for user's next message to choose song manually.
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
 *     message.channel.send(`**Choose an option from below**\n${results.map((song, i) => `**${i + 1}**. ${song.name} - \`${song.formattedDuration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
 * });
 */

/**
 * Emitted when {@link DisTubeOptions|DisTubeOptions.searchSongs} bigger than 0
 * and the search canceled due to {@link DisTubeOptions|DisTubeOptions.searchTimeout}
 *
 * @event DisTube#searchCancel
 * @param {Discord.Message} message The user message called play method
 * @param {string} query The search query
 * @example
 * // DisTubeOptions.searchSongs > 0
 * distube.on("searchCancel", (message) => message.channel.send(`Searching canceled`));
 */

/**
 * Emitted when {@link DisTubeOptions|DisTubeOptions.searchSongs} bigger than 0
 * and the search canceled due to user's next message is not a number or out of results range
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
 * Emitted when {@link DisTubeOptions|DisTubeOptions.searchSongs} bigger than 0
 * and after the user chose a search result to play
 *
 * @event DisTube#searchDone
 * @param {Discord.Message} message The user message called play method
 * @param {Discord.Message} answer The answered message of user
 * @param {string} query The search query
 */

/**
 * Emitted when the bot is disconnected to the voice channel
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
 * Emitted when DisTube finished a song
 *
 * @event DisTube#finishSong
 * @param {Queue} queue The guild queue
 * @param {Song} song Finished song
 */
