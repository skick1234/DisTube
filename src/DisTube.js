const ytdl = require("@distube/ytdl"),
  ytsr = require("@distube/ytsr"),
  ytpl = require("@distube/ytpl"),
  { EventEmitter } = require("events"),
  Queue = require("./Queue"),
  Song = require("./Song"),
  SearchResult = require("./SearchResult"),
  Playlist = require("./Playlist"),
  Discord = require("discord.js"),
  youtube_dl = require("@distube/youtube-dl"),
  { promisify } = require("util");
const youtube_dlOptions = ["--no-warnings", "--force-ipv4"];
youtube_dl.getInfo = promisify(youtube_dl.getInfo);

const isURL = string => {
  if (string.includes(" ")) return false;
  try {
    const url = new URL(string);
    if (!["https:", "http:"].includes(url.protocol) ||
      url.origin === "null" || !url.host
    ) return false;
  } catch { return false }
  return true;
}
const parseNumber = string => (typeof string === "string" ? Number(string.replace(/\D+/g, "")) : Number(string)) || 0;

/**
 * DisTube options.
 * @typedef {object} DisTubeOptions
 * @prop {boolean} [emitNewSongOnly=false] `@1.3.0`. If `true`, {@link DisTube#event:playSong} is not emitted when looping a song or next song is the same as the previous one
 * @prop {number} [highWaterMark=1<<24] `@2.2.0` ytdl's highWaterMark option.
 * @prop {boolean} [leaveOnEmpty=true] Whether or not leaving voice channel if channel is empty in 60s. (Avoid accident leaving)
 * @prop {boolean} [leaveOnFinish=false] Whether or not leaving voice channel when the queue ends.
 * @prop {boolean} [leaveOnStop=true] Whether or not leaving voice channel after using {@link DisTube#stop|stop()} function.
 * @prop {boolean} [searchSongs=false] Whether or not searching for multiple songs to select manually, DisTube will play the first result if `false`
 * @prop {string} [youtubeCookie=null] `@2.4.0` YouTube cookies. How to get it: {@link https://github.com/fent/node-ytdl-core/blob/784c04eaf9f3cfac0fe0933155adffe0e2e0848a/example/cookies.js#L6-L12|YTDL's Example}
 * @prop {string} [youtubeIdentityToken=null] `@2.4.0` If not given, ytdl-core will try to find it. You can find this by going to a video's watch page, viewing the source, and searching for "ID_TOKEN".
 * @prop {boolean} [youtubeDL=true] `@2.8.0` Whether or not using youtube-dl.
 * @prop {boolean} [updateYouTubeDL=true] `@2.8.0` Whether or not updating youtube-dl automatically.
 * @prop {Object.<string, string>} [customFilters] `@2.7.0` Override or add more ffmpeg filters. Example: `{ "Filter name": "Filter value", "8d": "apulsator=hz=0.075" }`
 */
const DisTubeOptions = {
  highWaterMark: 1 << 24,
  emitNewSongOnly: false,
  leaveOnEmpty: true,
  leaveOnFinish: false,
  leaveOnStop: true,
  searchSongs: false,
  youtubeCookie: null,
  youtubeIdentityToken: null,
  youtubeDL: true,
  updateYouTubeDL: true,
  customFilters: {},
};

/**
 * DisTube audio filters.
 * @typedef {("3d"|"bassboost"|"echo"|"karaoke"|"nightcore"|"vaporwave"|"flanger"|"gate"|"haas"|"reverse"|"surround"|"mcompand"|"phaser"|"tremolo"|"earwax"|string)} Filter
 * @prop {string} 3d `@2.0.0`
 * @prop {string} bassboost `@2.0.0`
 * @prop {string} echo `@2.0.0`
 * @prop {string} karaoke `@2.0.0`
 * @prop {string} nightcore `@2.0.0`
 * @prop {string} vaporwave `@2.0.0`
 * @prop {string} flanger `@2.4.0`
 * @prop {string} gate `@2.4.0`
 * @prop {string} haas `@2.4.0`
 * @prop {string} reverse `@2.4.0`
 * @prop {string} surround `@2.7.0`
 * @prop {string} mcompand `@2.7.0`
 * @prop {string} phaser `@2.7.0`
 * @prop {string} tremolo `@2.7.0`
 * @prop {string} earwax `@2.7.0`
 */
const ffmpegFilters = {
  "3d": "apulsator=hz=0.125",
  bassboost: "bass=g=10,dynaudnorm=f=150:g=15",
  echo: "aecho=0.8:0.9:1000:0.3",
  flanger: "flanger",
  gate: "agate",
  haas: "haas",
  karaoke: "stereotools=mlev=0.1",
  nightcore: "asetrate=48000*1.25,aresample=48000,bass=g=5",
  reverse: "areverse",
  vaporwave: "asetrate=48000*0.8,aresample=48000,atempo=1.1",
  mcompand: "mcompand",
  phaser: "aphaser",
  tremolo: "tremolo",
  surround: "surround",
  earwax: "earwax",
}

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
   * const distube = new DisTube(client, { searchSongs: true });
   * // client.DisTube = distube // make it access easily
   * client.login("Your Discord Bot Token")
   */
  constructor(client, otp = {}) {
    super();
    if (!client) throw new SyntaxError("Invalid Discord.Client");

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
    this.options = DisTubeOptions;
    Object.assign(this.options, otp);

    /**
     * DisTube filters
     * @type {Filter}
     */
    this.filters = ffmpegFilters;
    if (typeof otp.customFilters === "object") Object.assign(this.filters, otp.customFilters);

    this.requestOptions = this.options.youtubeCookie ? { headers: { cookie: this.options.youtubeCookie, "x-youtube-identity-token": this.options.youtubeIdentityToken } } : undefined;

    client.on("voiceStateUpdate", (oldState, newState) => {
      if (newState && newState.id === client.user.id && !newState.channelID) {
        let queue = this.guildQueues.find(gQueue => gQueue.connection && gQueue.connection.channel.id === oldState.channelID);
        if (!queue) return;
        let guildID = queue.connection.channel.guild.id;
        try { this.stop(guildID) } catch { this._deleteQueue(guildID) }
      }
      if (this.options.leaveOnEmpty && oldState && oldState.channel) {
        let queue = this.guildQueues.find(gQueue => gQueue.connection && gQueue.connection.channel.id === oldState.channelID);
        if (queue && this._isVoiceChannelEmpty(queue)) {
          setTimeout(() => {
            let guildID = queue.connection.channel.guild.id;
            if (this.guildQueues.has(guildID) && this._isVoiceChannelEmpty(queue)) {
              queue.connection.channel.leave();
              this.emit("empty", queue.initMessage);
              this._deleteQueue(queue.initMessage);
            }
          }, 60000)
        }
      }
    })

    if (this.options.updateYouTubeDL) {
      require("@distube/youtube-dl/lib/downloader")()
        .then(message => console.log(`[DisTube] ${message}`))
        .catch(console.error)
        .catch(() => console.log("[DisTube] Unable to update youtube-dl, using default version."));
    }
  }

  /**
   * Resolve a Song
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string|Song} song Youtube url | Search string | {@link Song}
   * @private
   * @ignore
   * @returns {Promise<Song|Song[]>} Resolved Song
   */
  async _resolveSong(message, song) {
    if (!song) return null;
    if (song instanceof Song) return song;
    if (song instanceof SearchResult) return new Song(await ytdl.getInfo(song.url, { requestOptions: this.requestOptions }), message.author, true);
    if (typeof song === "object") return new Song(song, message.author);
    if (ytdl.validateURL(song)) return new Song(await ytdl.getInfo(song, { requestOptions: this.requestOptions }), message.author, true);
    if (isURL(song)) {
      if (!this.options.youtubeDL) throw new Error("Not Supported URL!");
      let info = await youtube_dl.getInfo(song, youtube_dlOptions).catch(e => { throw new Error(`[youtube-dl] ${e.stderr || e}`) });
      if (Array.isArray(info) && info.length > 0) return info.map(i => new Song(i, message.author));
      return new Song(info, message.author);
    }
    return this._resolveSong(message, await this._searchSong(message, song));
  }

  /**
   * Handle a Song or an array of Song
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {Song|SearchResult} song {@link Song} | {@link SearchResult}
   * @private
   * @ignore
   */
  async _handleSong(message, song, skip = false) {
    if (!song) return;
    if (Array.isArray(song)) this._handlePlaylist(message, song, skip);
    else if (this.getQueue(message)) {
      let queue = this._addToQueue(message, song, skip);
      if (skip) this.skip(message);
      else this.emit("addSong", message, queue, song);
    } else {
      let queue = await this._newQueue(message, song);
      this.emit("playSong", message, queue, song);
    }
  }

  /**
   * Play / add a song or playlist from url. Search and play a song if it is not a valid url.
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string|Song|SearchResult} song Youtube url | Search string | {@link Song} | {@link SearchResult}
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "play")
   *         distube.play(message, args.join(" "));
   * });
   */
  async play(message, song) {
    if (!song) return;
    try {
      if (ytpl.validateID(song)) await this._handlePlaylist(message, song);
      else await this._handleSong(message, await this._resolveSong(message, song));
    } catch (e) {
      e.message = `play(${song}) encountered:\n${e.message}`;
      this._emitError(message, e);
    }
  }

  /**
   * `@2.0.0` Skip the playing song and play a song or playlist
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string|Song|SearchResult} song Youtube url | Search string | {@link Song} | {@link SearchResult}
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
      if (ytpl.validateID(song)) await this._handlePlaylist(message, song, true);
      else await this._handleSong(message, await this._resolveSong(message, song), true);
    } catch (e) {
      e.message = `playSkip(${song}) encountered:\n${e.message}`;
      this._emitError(message, e);
    }
  }

  /**
   * `@2.1.0` Play or add array of Youtube video urls.
   * {@link DisTube#event:playList} or {@link DisTube#event:addList} will be emitted
   * with `playlist`'s properties include `properties` parameter's properties such as
   * `user`, `songs`, `duration`, `formattedDuration`, `thumbnail` like {@link Playlist}
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string[]} urls Array of Youtube url
   * @param {Object} [properties={}] Additional properties such as `name`
   * @param {boolean} [playSkip=false] Whether or not play this playlist instantly
   * @example
   *     let songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
   *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" });
   */
  async playCustomPlaylist(message, urls, properties = {}, playSkip = false) {
    if (!urls.length) return;
    try {
      let songs = urls.filter(url => isURL(url)).map(url => this._resolveSong(message, url).catch(() => { }));
      songs = (await Promise.all(songs)).filter(song => song);
      let playlist = new Playlist(songs, message.author, properties);
      await this._handlePlaylist(message, playlist, playSkip);
    } catch (e) {
      this._emitError(message, e);
    }
  }

  /**
   * PLay / add a playlist
   * @async
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   * @param {string|Song[]|Playlist} arg2 Youtube playlist url | a Playlist
   * @param {boolean} skip Skip the current song
   */
  async _handlePlaylist(message, arg2, skip = false) {
    let playlist;
    if (typeof arg2 === "object") playlist = arg2; // Song[] or Playlist
    else if (typeof arg2 === "string") {
      playlist = await ytpl(arg2, { limit: Infinity });
      playlist.items = playlist.items.filter(v => !v.thumbnail.includes("no_thumbnail")).map(v => new Song(v, message.author, true));
    }
    if (!playlist) throw Error("Invalid Playlist");
    if (!(playlist instanceof Playlist)) playlist = new Playlist(playlist, message.author)
    if (!playlist.songs.length) throw Error("No valid video in the playlist");
    let songs = playlist.songs;
    let queue = this.getQueue(message);
    if (queue) {
      this._addSongsToQueue(message, songs, skip);
      if (skip) this.skip(message);
      else this.emit("addList", message, queue, playlist);
    } else {
      let song = songs.shift();
      queue = await this._newQueue(message, song);
      if (songs.length) this._addSongsToQueue(message, songs);
      songs.unshift(song);
      this.emit("playList", message, queue, playlist, queue.songs[0]);
    }
  }

  /**
   * `@2.0.0` Search for a song. You can customize how user answers instead of send a number.
   * Then use {@link DisTube#play|play(message, aResultFromSearch)} or {@link DisTube#playSkip|playSkip()} to play it.
   * @async
   * @param {string} string The string search for
   * @throws {NotFound} If not found
   * @throws {Error} If an error encountered
   * @returns {Promise<SearchResult[]>} Array of results
   */
  async search(string, retried = false) {
    try {
      let search = await ytsr(string, { limit: 15 });
      let results = search.items.map(i => new SearchResult(i));
      if (results.length === 0) throw Error("No result!");
      return results;
    } catch (e) {
      if (retried) throw e;
      return this.search(string, true);
    }
  }

  /**
   * Search for a song, fire {@link DisTube#event:error} if not found.
   * @async
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   * @param {string} name The string search for
   * @returns {Song} Song info
   */
  async _searchSong(message, name) {
    let results = await this.search(name);
    let result = results[0];
    if (this.options.searchSongs) {
      this.emit("searchResult", message, results);
      try {
        let answers = await message.channel.awaitMessages(m => m.author.id === message.author.id, {
          max: 1,
          time: 60000,
          errors: ["time"],
        })
        if (!answers.first()) throw new Error();
        let index = parseInt(answers.first().content, 10);
        if (isNaN(index) || index > results.length || index < 1) throw new Error();
        result = results[index - 1];
      } catch {
        this.emit("searchCancel", message);
        return null;
      }
    }
    return result;
  }

  /**
   * Create a new guild queue
   * @async
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   * @param {Song} song Song to play
   * @throws {NotInVoice} if user not in a voice channel
   * @returns {Promise<Queue>}
   */
  async _newQueue(message, song, retried = false) {
    let voice = message.member.voice.channel;
    if (!voice) throw new Error("User is not in the voice channel.");
    let queue = new Queue(message, song);
    this.emit("initQueue", queue);
    this.guildQueues.set(message.guild.id, queue);
    try {
      queue.connection = await voice.join();
    } catch (e) {
      this._deleteQueue(message);
      e.message = `DisTube cannot join the voice channel!\nReason: ${e.message}`;
      if (retried) throw e;
      return this._newQueue(message, song, true);
    }
    queue.connection.on("error", e => {
      e.message = `There is a problem with Discord Voice Connection.\nPlease try again! Sorry for the interruption!\nReason: ${e.message}`;
      this._emitError(message, e);
      this._deleteQueue(message);
    })
    await this._playSong(message);
    return queue;
  }

  /**
   * Delete a guild queue
   * @private
   * @ignore
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   */
  _deleteQueue(message) {
    let queue = this.getQueue(message);
    if (!queue) return;
    if (queue.dispatcher) try { queue.dispatcher.destroy() } catch { }
    if (queue.stream) try { queue.stream.destroy() } catch { }
    if (typeof message === "string") this.guildQueues.delete(message);
    else if (message && message.guild) this.guildQueues.delete(message.guild.id);
  }

  /**
   * Get the guild queue
   * @param {Discord.Snowflake|Discord.Message} message The guild ID or message from guild channel.
   * @returns {Queue} The guild queue
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
   * Add a video to queue
   * @private
   * @ignore
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @param {Song} song Song to add
   * @param {boolean} [unshift=false] Unshift
   * @throws {NotInVoice} if result is empty
   * @returns {Queue}
   */
  _addToQueue(message, song, unshift = false) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    if (!song) throw new Error("NoSong");
    if (unshift) {
      let playing = queue.songs.shift();
      queue.songs.unshift(playing, song);
    } else { queue.songs.push(song); }
    return queue;
  }

  /**
   * Add a array of videos to queue
   * @private
   * @ignore
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @param {Song[]} songs Array of song to add
   * @param {boolean} [unshift=false] Unshift
   * @returns {Queue}
   */
  _addSongsToQueue(message, songs, unshift = false) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    if (!songs.length) throw new Error("NoSong");
    if (unshift) {
      let playing = queue.songs.shift();
      queue.songs.unshift(playing, ...songs);
    } else { queue.songs.push(...songs); }
    return queue;
  }

  /**
   * Pause the guild stream
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
   * @throws {NotPlaying} No playing queue
   */
  pause(message) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    queue.playing = false;
    queue.pause = true;
    queue.dispatcher.pause();
    return queue;
  }

  /**
   * Resume the guild stream
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
   * @throws {NotPlaying} No playing queue
   */
  resume(message) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    queue.playing = true;
    queue.pause = false;
    queue.dispatcher.resume();
    return queue;
  }

  /**
   * Stop the guild stream
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @throws {NotPlaying} No playing queue
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
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    queue.stopped = true;
    if (queue.dispatcher) try { queue.dispatcher.end() } catch { }
    if (this.options.leaveOnStop && queue.connection) try { queue.connection.channel.leave() } catch { }
    this._deleteQueue(message);
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
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    queue.volume = percent;
    queue.dispatcher.setVolume(queue.volume / 100);
    return queue
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
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    if (queue.songs <= 1 && !queue.autoplay) throw new Error("NoSong");
    queue.skipped = true;
    queue.dispatcher.end();
    return queue;
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
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    let playing = queue.songs.shift();
    for (let i = queue.songs.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));
      [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
    }
    queue.songs.unshift(playing);
    return queue;
  }

  /**
   * Jump to the song number in the queue.
   * The next one is 1,...
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
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    if (num > queue.songs.length || num < 1) throw new Error("InvalidSong");
    queue.songs = queue.songs.splice(num - 1);
    queue.skipped = true;
    if (queue.dispatcher) queue.dispatcher.end();
    return queue;
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
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    mode = parseInt(mode, 10);
    if (!mode && mode !== 0) queue.repeatMode = (queue.repeatMode + 1) % 3;
    else if (queue.repeatMode === mode) queue.repeatMode = 0;
    else queue.repeatMode = mode;
    return queue.repeatMode;
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
    let queue = this.getQueue(message);
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
    let queue = this.getQueue(message);
    return queue ? queue.playing || !queue.pause : false;
  }

  /**
   * Whether or not the guild queue is paused
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel to check
   * @returns {boolean} Whether or not the guild queue is paused
   */
  isPaused(message) {
    let queue = this.getQueue(message);
    return queue ? queue.pause : false;
  }

  /**
   * Whether or not the queue's voice channel is empty
   * @private
   * @ignore
   * @param {Queue} queue The guild queue
   * @returns {boolean} No user in voice channel return `true`
   */
  _isVoiceChannelEmpty(queue) {
    let voiceChannel = queue.connection.channel;
    let members = voiceChannel.members.filter(m => !m.user.bot);
    return !members.size;
  }

  /**
   * TODO: Remove this
   * @deprecated use {@link DisTube#addRelatedVideo} instead
   * @param {DisTube.Message} message Message
   * @returns {Promise<Queue>}
   */
  runAutoplay(message) {
    console.warn(`\`DisTube#runAutoplay\` is deprecated, use \`DisTube#addRelatedVideo\` instead.`);
    return this.addRelatedVideo(message);
  }

  /**
   * Add related song to the queue
   * @async
   * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
   * @returns {Promise<Queue>} The guild queue
   */
  async addRelatedVideo(message) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    let song = queue.songs[0];
    if (!song.youtube) {
      this.emit("noRelated", message);
      return queue;
    }
    let related = song.related;
    if (!Array.isArray(related)) related = (await ytdl.getBasicInfo(song.url, { requestOptions: this.requestOptions })).related_videos;
    if (Array.isArray(related)) {
      const relatedVideo = related.find(s => !queue.previousSongs.includes(s.id));
      if (!relatedVideo && !relatedVideo.id) {
        this.emit("noRelated", message);
        return queue;
      }
      this._addToQueue(message, new Song(await ytdl.getInfo(relatedVideo.id, { requestOptions: this.requestOptions }), this.client.user, true));
    } else this.emit("noRelated", message);
    return queue;
  }

  /**
   * `@2.0.0` Enable or disable a filter of the queue, replay the playing song.
   * Available filters: {@link Filter}
   *
   * @param {Discord.Message} message The message from guild channel
   * @param {Filter} filter A filter name
   * @returns {string} Current queue's filter name.
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if ([`3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`].includes(command)) {
   *         let filter = distube.setFilter(message, command);
   *         message.channel.send("Current queue filter: " + (filter || "Off"));
   *     }
   * });
   */
  setFilter(message, filter) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    if (!Object.prototype.hasOwnProperty.call(this.filters, filter)) throw new TypeError(`${filter} is not a Filter (https://DisTube.js.org/global.html#Filter).`);
    if (queue.filter === filter) queue.filter = null;
    else queue.filter = filter;
    queue.beginTime = queue.currentTime;
    this._playSong(message);
    return queue.filter;
  }

  /**
   * `@2.7.0` Set the playing time to another position
   *
   * @param {Discord.Message} message The message from guild channel
   * @param {number} time Time in milliseconds
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
    queue.beginTime = time;
    this._playSong(message);
  }

  /**
   * Emit error event
   * @private
   * @ignore
   */
  _emitError(message, error) {
    if (this.listeners("error").length) this.emit("error", message, error);
    else this.emit("error", error);
  }

  /**
   * Whether or not emit playSong event
   * @private
   * @ignore
   */
  _emitPlaySong(queue) {
    if (
      !this.options.emitNewSongOnly ||
      (
        queue.repeatMode !== 1 &&
        (!queue.songs[1] || queue.songs[0].id !== queue.songs[1].id)
      )
    ) return true;
    return false;
  }

  /**
   * Create a ytdl stream
   * @private
   * @ignore
   */
  _createStream(queue) {
    let song = queue.songs[0];
    let encoderArgs = queue.filter ? ["-af", this.filters[queue.filter]] : null;
    let streamOptions = {
      opusEncoded: true,
      filter: song.isLive ? "audioandvideo" : "audioonly",
      quality: "highestaudio",
      highWaterMark: this.options.highWaterMark,
      requestOptions: this.requestOptions,
      encoderArgs,
      seek: queue.beginTime / 1000,
    };
    if (song.youtube) return ytdl(song.info, streamOptions);
    return ytdl.arbitraryStream(song.streamURL, streamOptions);
  }

  /**
   * Play a song on voice connection
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   */
  async _playSong(message) {
    let queue = this.getQueue(message);
    if (!queue) return;
    if (!queue.songs.length) {
      this._deleteQueue(message);
      return;
    }
    let song = queue.songs[0];
    try {
      let errorEmitted = false;
      // Queue.stream.on('info') should works but maybe DisTube#playSong will emit before ytdl#info
      if (song.youtube && !song.info) {
        let { videoDetails } = song.info = await ytdl.getInfo(song.url, { requestOptions: this.requestOptions });
        song.views = parseNumber(videoDetails.viewCount);
        song.likes = parseNumber(videoDetails.likes);
        song.dislikes = parseNumber(videoDetails.dislikes);
        if (song.info.formats.length) {
          song.streamURL = ytdl.chooseFormat(song.info.formats, {
            filter: song.isLive ? "audioandvideo" : "audioonly",
            quality: "highestaudio",
          }).url;
        }
      }
      let stream = this._createStream(queue).on("error", e => {
        errorEmitted = true;
        e.message = `${e.message}\nID: ${song.id}\nName: ${song.name}`;
        this._emitError(message, e);
      });
      queue.dispatcher = queue.connection.play(stream, {
        highWaterMark: 1,
        type: "opus",
        volume: queue.volume / 100,
        bitrate: "auto",
      }).on("finish", () => this._handleSongFinish(message, queue))
        .on("error", e => {
          this._handlePlayingError(message, queue, errorEmitted ? null : e);
        });
      if (queue.stream) queue.stream.destroy();
      queue.stream = stream;
    } catch (e) {
      this._handlePlayingError(message, queue, e);
    }
  }

  /**
   * Handle the queue when a Song finish
   * @private
   * @ignore
   * @param {Discord.Message} message message
   * @param {Queue} queue queue
   */
  async _handleSongFinish(message, queue) {
    if (queue.stopped) return;
    if (this.options.leaveOnEmpty && this._isVoiceChannelEmpty(queue)) {
      this._deleteQueue(message);
      queue.connection.channel.leave();
      this.emit("empty", message);
      return;
    }
    if (queue.repeatMode === 2 && !queue.skipped) queue.songs.push(queue.songs[0]);
    if (queue.songs.length <= 1 && (queue.skipped || !queue.repeatMode)) {
      if (queue.autoplay) try { await this.addRelatedVideo(message) } catch { this.emit("noRelated", message) }
      if (queue.songs.length <= 1) {
        this._deleteQueue(message);
        if (this.options.leaveOnFinish && !queue.stopped) queue.connection.channel.leave();
        if (!queue.autoplay) this.emit("finish", message);
        return;
      }
    }
    const emitSong = this._emitPlaySong(queue);
    if (queue.repeatMode !== 1 || queue.skipped) {
      const { id } = queue.songs.shift();
      queue.previousSongs.push(id);
    }
    queue.skipped = false;
    queue.beginTime = 0;
    await this._playSong(message);
    if (emitSong) this.emit("playSong", message, queue, queue.songs[0]);
  }

  /**
   * Handle error while playing
   * @private
   * @ignore
   * @param {Discord.Message} message message
   * @param {Queue} queue queue
   * @param {Error} error error
   */
  _handlePlayingError(message, queue, error = null) {
    let song = queue.songs.shift();
    if (error) {
      error.message = `${error.message}\nID: ${song.id}\nName: ${song.name}`;
      this._emitError(message, error);
    }
    if (queue.songs.length > 0) this._playSong(message).then(() => this.emit("playSong", message, queue, queue.songs[0]));
    else try { this.stop(message) } catch { this._deleteQueue(message) }
  }
}

module.exports = DisTube;

/**
 *  Emitted after DisTube add playlist to guild queue
 *
 * @event DisTube#addList
 * @param {Discord.Message} message The message from guild channel
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
 * @param {Discord.Message} message The message from guild channel
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
 * @param {Discord.Message} message The message from guild channel
 * @example
 * distube.on("empty", message => message.channel.send("Channel is empty. Leaving the channel"))
 */

/**
 * Emitted when {@link DisTube} encounters an error.
 *
 * @event DisTube#error
 * @param {Discord.Message} message The message from guild channel
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
 * @param {Discord.Message} message The message from guild channel
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
 * @param {Discord.Message} message The message from guild channel
 * @example
 * distube.on("noRelated", message => message.channel.send("Can't find related video to play. Stop playing music."));
 */

/**
 * Emitted after DisTube play the first song of the playlist
 * and add the rest to the guild queue
 *
 * @event DisTube#playList
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {Playlist} playlist Playlist info
 * @param {Song} song Playing song
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("playList", (message, queue, playlist, song) => message.channel.send(
 *     `Play \`${playlist.name}\` playlist (${playlist.songs.length} songs).\nRequested by: ${song.user}\nNow playing \`${song.name}\` - \`${song.formattedDuration}\`\n${status(queue)}`
 * ));
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
 * distube.on("playSong", (message, queue, song) => message.channel.send(
 *     `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}\n${status(queue)}`
 * ));
 */

/**
 * Emitted when {@link DisTubeOptions}.searchSongs is `true`.
 * Search will be canceled if user's next message is invalid number or timeout (60s)
 *
 * @event DisTube#searchCancel
 * @param {Discord.Message} message The message from guild channel
 * @example
 * // DisTubeOptions.searchSongs = true
 * distube.on("searchCancel", (message) => message.channel.send(`Searching canceled`));
 */

/**
 * Emitted when {@link DisTubeOptions}.searchSongs is `true`.
 * DisTube will wait for user's next message to choose song manually
 * if song param of {@link DisTube#play|play()} is invalid url
 *
 * @event DisTube#searchResult
 * @param {Discord.Message} message The message from guild channel
 * @param {SearchResult[]} result Searched result (max length = 12)
 * @example
 * // DisTubeOptions.searchSongs = true
 * distube.on("searchResult", (message, result) => {
 *     let i = 0;
 *     message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.name} - \`${song.formattedDuration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
 * });
 */
