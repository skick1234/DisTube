const ytsr = require("@distube/ytsr"),
  ytpl = require("@distube/ytpl"),
  { EventEmitter } = require("events"),
  Queue = require("./Queue"),
  SearchResult = require("./SearchResult"),
  Playlist = require("./Playlist"),
  { isURL, isVoiceChannelEmpty } = require("./util"),
  Discord = require("discord.js"),
  DisTubeOption = require("./DisTubeOptions"),
  Handler = require("./DisTubeHandler"),
  // eslint-disable-next-line no-unused-vars
  Song = require("./Song");

/**
 * @typedef {Object.<string, string>} Filters
 * @ignore
 */

/**
 * DisTube options.
 * @typedef {Object} DisTubeOptions
 * @prop {boolean} [emitNewSongOnly=false] `@1.3.0`. If `true`, {@link DisTube#event:playSong} will not be emitted when looping a song or next song is the same as the previous one
 * @prop {boolean} [leaveOnEmpty=true] Whether or not leaving voice channel if channel is empty in 60s. (Avoid accident leaving)
 * @prop {boolean} [leaveOnFinish=false] Whether or not leaving voice channel when the queue ends.
 * @prop {boolean} [leaveOnStop=true] Whether or not leaving voice channel after using {@link DisTube#stop|stop()} function.
 * @prop {boolean} [savePreviousSongs=true] Whether or not saving the previous songs of the queue and enable {@link DisTube#previous|previous()} method
 * @prop {number} [searchSongs=0] Whether or not searching for multiple songs to select manually; DisTube will play the first result if `false`
 * @prop {string} [youtubeCookie=null] `@2.4.0` YouTube cookies. Read how to get it in {@link https://github.com/fent/node-ytdl-core/blob/997efdd5dd9063363f6ef668bb364e83970756e7/example/cookies.js#L6-L12|YTDL's Example}
 * @prop {string} [youtubeIdentityToken=null] `@2.4.0` If not given; ytdl-core will try to find it. You can find this by going to a video's watch page; viewing the source; and searching for "ID_TOKEN".
 * @prop {boolean} [youtubeDL=true] `@2.8.0` Whether or not using youtube-dl.
 * @prop {boolean} [updateYouTubeDL=true] `@2.8.0` Whether or not updating youtube-dl automatically.
 * @prop {Filters} [customFilters] `@2.7.0` Override {@link DefaultFilters} or add more ffmpeg filters. Example=`{ "Filter name"="Filter value"; "8d"="apulsator=hz=0.075" }`
 * @prop {Object} [ytdlOptions] `@3.0.0` `ytdl-core` options
 * @prop {number} [searchCooldown=60000] Built-in search cooldown in milliseconds (When searchSongs is bigger than 0)
 * @prop {number} [emptyCooldown=60000] Built-in leave on empty cooldown in milliseconds (When leaveOnEmpty is true)
 */

/**
 * Class representing a DisTube.
 * @extends EventEmitter
 */
class DisTube extends EventEmitter {
  /**
   * DisTube's current version.
   * @type {string}
   * @ignore
   */
  get version() { return require("../package.json").version }
  static get version() { return require("../package.json").version }
  /**
   * Create new DisTube.
   * @param {Discord.Client} client Discord.JS client
   * @param {DisTubeOptions} [otp={}] Custom DisTube options
   * @example
   * const Discord = require('discord.js'),
   *     DisTube = require('distube'),
   *     client = new Discord.Client();
   * // Create a new DisTube
   * const distube = new DisTube(client, { searchSongs: 10 });
   * // client.DisTube = distube // make it access easily
   * client.login("Your Discord Bot Token")
   */
  constructor(client, otp = {}) {
    super();
    if (!client || !client.user) throw new TypeError("Invalid Discord.Client");

    /**
     * Discord.JS client
     * @type {Discord.Client}
     */
    this.client = client;

    /**
     * Collection of guild queues
     * @type {Discord.Collection<string, Queue>}
     */
    this.guildQueues = new Discord.Collection();

    /**
     * DisTube options
     * @type {DisTubeOptions}
     */
    this.options = new DisTubeOption(otp);

    this.handler = new Handler(this);

    /**
     * DisTube filters
     * @type {Filters}
     */
    this.filters = require("./Filter");
    if (typeof this.options.customFilters === "object") Object.assign(this.filters, this.options.customFilters);

    let timeout = null;
    client.on("voiceStateUpdate", oldState => {
      let queue = this.guildQueues.find(gQueue => gQueue.connection && gQueue.connection.channel.id === oldState.channelID);
      if (!queue || !this.options.leaveOnEmpty) return;
      if (oldState && oldState.channel && isVoiceChannelEmpty(queue)) {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        timeout = setTimeout(() => {
          let guildID = queue.connection.channel.guild.id;
          if (this.guildQueues.has(guildID) && isVoiceChannelEmpty(queue)) {
            queue.connection.channel.leave();
            this.emit("empty", queue.textChannel);
            this._deleteQueue(queue.textChannel.guild.id);
          }
        }, this.options.emptyCooldown);
      } else if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    });

    if (this.options.updateYouTubeDL) {
      require("@distube/youtube-dl/src/download")()
        .then(version => console.log(`[DisTube] Updated youtube-dl to ${version}!`))
        .catch(console.error)
        .catch(() => console.log("[DisTube] Unable to update youtube-dl, using default version."));
    }
  }

  /**
   * Play / add a song or playlist from url. Search and play a song if it is not a valid url.
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string|Song|SearchResult|Playlist} song Youtube url | Search string | {@link Song} | {@link SearchResult} | {@link Playlist}
   * @param {boolean} skip Wether or not skipping the playing song
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "play")
   *         distube.play(message, args.join(" "));
   * });
   */
  async play(message, song, skip = false) {
    if (!song) return;
    try {
      if (ytpl.validateID(song)) await this._handlePlaylist(message, await this.handler.resolvePlaylist(message, song), skip);
      else {
        song = await this.handler.resolveSong(message, song);
        if (song instanceof Playlist) await this._handlePlaylist(message, song, skip);
        if (!song) return;
        let queue = this.getQueue(message);
        if (queue) {
          queue.addToQueue(song, skip);
          if (skip) queue.skip();
          else this.emit("addSong", queue, song);
        } else {
          queue = await this._newQueue(message, song);
          if (queue instanceof Queue) this.emit("playSong", queue, song);
        }
      }
    } catch (e) {
      e.message = `play(${song}) encountered:\n${e.message}`;
      this.emitError(message.channel, e);
    }
  }

  /**
   * `@2.0.0` Skip the playing song and play a song or playlist
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string|Song|SearchResult|Playlist} song Youtube url | Search string | {@link Song} | {@link SearchResult} | {@link Playlist}
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "playSkip")
   *         distube.playSkip(message, args.join(" "));
   * });
   */
  async playSkip(message, song) {
    if (!song) return;
    try {
      await this.play(message, song, true);
    } catch (e) {
      e.message = `playSkip(${song}) encountered:\n${e.message}`;
      this.emitError(message.channel, e);
    }
  }

  /**
   * `@2.1.0` Play or add array of video urls.
   * {@link DisTube#event:playList} or {@link DisTube#event:addList} will be emitted
   * with `playlist`'s properties include `properties` parameter's properties such as
   * `user`, `songs`, `duration`, `formattedDuration`, `thumbnail` like {@link Playlist}
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string[]} songs Array of url
   * @param {Object} [properties={}] Additional properties such as `name`
   * @param {boolean} [playSkip=false] Whether or not play this playlist instantly
   * @param {boolean} [parallel=true] `@3.0.0` Whether or not fetch the playlist in parallel
   * @example
   *     let songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
   *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" });
   *     // Fetching custom playlist sequentially (reduce lag for low specs)
   *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" }, false, false);
   */
  async playCustomPlaylist(message, songs, properties = {}, playSkip = false, parallel = true) {
    if (!songs.length) return;
    try {
      songs = songs.filter(url => isURL(url));
      if (parallel) {
        songs = songs.map(url => this._resolveSong(message, url).catch(() => undefined));
        songs = (await Promise.all(songs)).filter(song => song);
      } else {
        let resolved = [];
        for (let song of songs) {
          // eslint-disable-next-line no-await-in-loop
          resolved.push(await this._resolveSong(message, song).catch(() => undefined));
        }
        songs = resolved.filter(song => song);
      }
      let playlist = new Playlist(songs, message.member, properties);
      await this._handlePlaylist(message, playlist, playSkip);
    } catch (e) {
      this.emitError(message.channel, e);
    }
  }

  /**
   * Play / add a playlist
   * @async
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   * @param {Playlist} playlist Youtube playlist url | a Playlist
   * @param {boolean} skip Skip the current song
   */
  async _handlePlaylist(message, playlist, skip = false) {
    if (!playlist || !(playlist instanceof Playlist)) throw Error("Invalid Playlist");
    if (!playlist.songs.length) throw Error("No valid video in the playlist");
    const songs = playlist.songs;
    let queue = this.getQueue(message);
    if (queue) {
      queue.addToQueue(songs, skip);
      if (skip) queue.skip();
      else this.emit("addList", queue, playlist);
    } else {
      queue = await this._newQueue(message, songs);
      if (queue instanceof Queue) this.emit("playSong", queue, queue.songs[0]);
    }
  }

  /**
   * `@2.0.0` Search for a song. You can customize how user answers instead of send a number.
   * Then use {@link DisTube#play|play(message, aResultFromSearch)} or {@link DisTube#playSkip|playSkip()} to play it.
   * @async
   * @param {string} string The string search for
   * @param {Object} options Search options
   * @param {number} [options.limit=10] Limit the results
   * @param {"video"|"playlist"} [options.type="video"] Type of search (video or playlist).
   * @param {boolean} retried Retried?
   * @throws {Error} If an error encountered
   * @returns {Promise<SearchResult[]>} Array of results
   */
  async search(string, options = {}, retried = false) {
    const opts = Object.assign({ type: "video", limit: 10 }, options);
    if (!["video", "playlist"].includes(opts.type)) throw new Error("options.type must be 'video' or 'playlist'.");
    if (typeof opts.limit !== "number") throw new Error("options.limit must be a number");
    try {
      const search = await ytsr(string, opts);
      const results = search.items.map(i => new SearchResult(i));
      if (results.length === 0) throw Error("No result!");
      return results;
    } catch (e) {
      if (retried) throw e;
      return this.search(string, true);
    }
  }

  /**
   * Create a new guild queue
   * @async
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   * @param {Song|Song[]} song Song to play
   * @param {boolean} retried retried?
   * @throws {Error} If an error encountered
   * @returns {Promise<Queue|true>}
   */
  _newQueue(message, song) {
    const voice = message.member.voice.channel;
    if (!voice) throw new Error("User is not in the voice channel.");
    const queue = new Queue(this, message, song);
    this.emit("initQueue", queue);
    this.guildQueues.set(message.guild.id, queue);
    return this.handler.joinVoiceChannel(queue, voice);
  }

  /**
   * Delete a guild queue
   * @private
   * @param {Discord.Snowflake|Discord.Message|Queue} queue The message from guild channel | Queue
   */
  _deleteQueue(queue) {
    if (!(queue instanceof Queue)) queue = this.getQueue(queue);
    if (!queue) return;
    if (queue.dispatcher) try { queue.dispatcher.destroy() } catch { }
    if (queue.stream) try { queue.stream.destroy() } catch { }
    this.guildQueues.delete(queue.id);
  }

  /**
   * Get the guild queue
   * @param {Discord.Snowflake|Discord.Message} message The guild ID or message from guild channel.
   * @returns {Queue} The guild queue
   * @throws {Error} If an error encountered
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "queue") {
   *         let queue = distube.getQueue(message);
   *         message.channel.send('Current queue:\n' + queue.songs.map((song, id) =>
   *             `**${id+1}**. [${song.name}](${song.url}) - \`${song.formattedDuration}\``
   *         ).join("\n"));
   *     }
   * });
   */
  getQueue(message) {
    if (typeof message === "string") return this.guildQueues.get(message);
    if (!message || !message.guild) throw TypeError("Parameter should be Discord.Message or server ID!");
    return this.guildQueues.get(message.guild.id);
  }

  /**
   * Pause the guild stream
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
   * @throws {Error} If an error encountered
   */
  pause(message) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.pause();
  }

  /**
   * Resume the guild stream
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
   * @throws {Error} If an error encountered
   */
  resume(message) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.resume();
  }

  /**
   * Stop the guild stream
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel or Queue
   * @throws {Error} If an error encountered
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
  stop(message) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    queue.stop();
  }

  /**
   * Set the guild stream's volume
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @param {number} percent The percentage of volume you want to set
   * @returns {Queue} The guild queue
   * @throws {NotPlaying} No playing queue
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "volume")
   *         distube.setVolume(message, args[0]);
   * });
   */
  setVolume(message, percent) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.setVolume(percent);
  }

  /**
   * Skip the playing song
   *
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
   * @throws {NotPlaying} No playing queue
   * @throws {NoSong} if there is no song in queue
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "skip")
   *         distube.skip(message);
   * });
   */
  skip(message) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.skip();
  }

  /**
   * Play the previous song
   *
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
   * @throws {Disabled} If this method is disabled
   * @throws {NotPlaying} No playing queue
   * @throws {NoSong} if there is no previous song
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "previous")
   *         distube.previous(message);
   * });
   */
  previous(message) {
    if (!this.options.savePreviousSongs) throw new Error("Disabled");
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.previous();
  }

  /**
   * Shuffle the guild queue songs
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "shuffle")
   *         distube.shuffle(message);
   * });
   */
  shuffle(message) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.shuffle();
  }

  /**
   * Jump to the song number in the queue.
   * The next one is 1, 2,...
   * The previous one is -1, -2,...
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @param {number} num The song number to play
   * @returns {Queue} The guild queue
   * @throws {InvalidSong} if `num` is invalid number (0 < num < {@link Queue#songs}.length)
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
  jump(message, num) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.jump(num);
  }

  /**
   * Set the repeat mode of the guild queue.
   * Turn off if repeat mode is the same value as new mode.
   * Toggle mode: `mode = null` `(0 -> 1 -> 2 -> 0...)`
   *
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @param {number} mode The repeat modes `(0: disabled, 1: Repeat a song, 2: Repeat all the queue)`
   * @returns {number} The new repeat mode
   *
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
  setRepeatMode(message, mode = null) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.setRepeatMode(mode);
  }

  /**
   * Toggle autoplay mode
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {boolean} Autoplay mode state
   * @throws {NotPlaying} No playing queue
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
  toggleAutoplay(message) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    queue.autoplay = !queue.autoplay;
    return queue.autoplay;
  }

  /**
   * Whether or not a guild is playing music.
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel to check
   * @returns {boolean} Whether or not the guild is playing song(s)
   */
  isPlaying(message) {
    const queue = this.getQueue(message);
    return queue ? queue.playing || !queue.pause : false;
  }

  /**
   * Whether or not the guild queue is paused
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel to check
   * @returns {boolean} Whether or not the guild queue is paused
   */
  isPaused(message) {
    const queue = this.getQueue(message);
    return queue ? queue.pause : false;
  }

  /**
   * Add related song to the queue
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Promise<Queue>} The guild queue
   */
  addRelatedVideo(message) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.addRelatedVideo();
  }

  /**
   * `@2.0.0` Enable or disable a filter of the queue, replay the playing song.
   * Available filters: {@link Filter}
   *
   * @param {Discord.Message} message The message from guild channel
   * @param {Filter} filter A filter name
   * @returns {Filter[]} Enabled filters.
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
  setFilter(message, filter) {
    const queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.setFilter(filter);
  }

  /**
   * `@2.7.0` Set the playing time to another position
   * @param {Discord.Message} message The message from guild channel
   * @param {number} time Time in milliseconds
   * @returns {Queue}
   * @example
   * client.on('message', message => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command = 'seek')
   *         distube.seek(message, Number(args[0]));
   * });
   */
  seek(message, time) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    return queue.seek(time);
  }

  /**
   * Emit error event
   * @param {Discord.TextChannel} channel Text channel where the error is encountered.
   * @param {Error} error error
   * @ignore
   */
  emitError(channel, error) {
    if (this.listeners("error").length) this.emit("error", channel, error);
    else this.emit("error", error);
  }
}

module.exports = DisTube;

/**
 *  Emitted after DisTube add playlist to guild queue
 *
 * @event DisTube#addList
 * @param {Queue} queue The guild queue
 * @param {Playlist} playlist Playlist info
 * @since 1.1.0
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("addList", (message, queue, playlist) => message.channel.send(
 *     `Added \`${playlist.name}\` playlist (${playlist.songs.length} songs) to queue\n${status(queue)}`
 * ));
 */

/**
 *  Emitted after DisTube add new song to guild queue
 *
 * @event DisTube#addSong
 * @param {Queue} queue The guild queue
 * @param {Song} song Added song
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("addSong", (message, queue, song) => message.channel.send(
 *     `Added ${song.name} - \`${song.formattedDuration}\` to the queue by ${song.user}`
 * ));
 */

/**
 * Emitted when there is no user in VoiceChannel and {@link DisTubeOptions}.leaveOnEmpty is `true`.
 *
 * @event DisTube#empty
 * @param {Discord.TextChannel} channel The text channel play commands called
 * @example
 * distube.on("empty", message => message.channel.send("Channel is empty. Leaving the channel"))
 */

/**
 * Emitted when {@link DisTube} encounters an error.
 *
 * @event DisTube#error
 * @param {Discord.TextChannel} channel Text channel where the error is encountered.
 * @param {Error} err The error encountered
 * @example
 * distube.on("error", (message, err) => message.channel.send(
 *     "An error encountered: " + err
 * ));
 */

/**
 * Emitted when there is no more song in the queue and {@link Queue#autoplay} is `false`.
 * DisTube will leave voice channel if {@link DisTubeOptions}.leaveOnFinish is `true`
 *
 * @event DisTube#finish
 * @param {Discord.TextChannel} channel The text channel play commands called
 * @example
 * distube.on("finish", message => message.channel.send("No more song in queue"));
 */

/**
 * `@2.3.0` Emitted when DisTube initialize a queue to change queue default properties.
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
 * @param {Discord.TextChannel} channel The text channel play commands called
 * @example
 * distube.on("noRelated", message => message.channel.send("Can't find related video to play. Stop playing music."));
 */

/**
 * Emitted when DisTube play a song.
 * If {@link DisTubeOptions}.emitNewSongOnly is `true`, event is not emitted when looping a song or next song is the previous one
 *
 * @event DisTube#playSong
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {Song} song Playing song
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("playSong", (queue, song) => queue.textChannel.send(
 *     `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}\n${status(queue)}`
 * ));
 */

/**
 * Emitted when {@link DisTubeOptions}.searchSongs bigger than 0.
 * Search will be canceled if user's next message is invalid number or timeout (60s)
 *
 * @event DisTube#searchCancel
 * @param {Discord.Message} message The message from guild channel
 * @example
 * // DisTubeOptions.searchSongs > 0
 * distube.on("searchCancel", (message) => message.channel.send(`Searching canceled`));
 */

/**
 * Emitted when {@link DisTubeOptions}.searchSongs bigger than 0.
 * DisTube will wait for user's next message to choose song manually
 * if song param of {@link DisTube#play|play()} is invalid url
 *
 * @event DisTube#searchResult
 * @param {Discord.Message} message The message from guild channel
 * @param {SearchResult[]} result Searched result (max length = 12)
 * @example
 * // DisTubeOptions.searchSongs > 0
 * distube.on("searchResult", (message, result) => {
 *     let i = 0;
 *     message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.name} - \`${song.formattedDuration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
 * });
 */
