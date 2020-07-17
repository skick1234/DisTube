const ytdl = require("discord-ytdl-core"),
  ytsr = require("ytsr"),
  // ytpl = require("ytpl"),
  ytpl = require("../node-ytpl"), // ytpl quick fixes before author update it.
  { EventEmitter } = require("events"),
  Queue = require("./Queue"),
  Song = require("./Song"),
  duration = require("./duration"),
  Discord = require("discord.js"); // eslint-disable-line

const toSecond = (string) => {
  let h = 0,
    m = 0,
    s = 0;
  if (string.match(/:/g)) {
    let time = string.split(":");
    if (time.length == 2) {
      m = parseInt(time[0]);
      s = parseInt(time[1]);
    } else if (time.length == 3) {
      h = parseInt(time[0]);
      m = parseInt(time[1]);
      s = parseInt(time[2]);
    }
  } else s = parseInt(string);
  return h * 60 * 60 + m * 60 + s;
};

/**
 * DisTube options.
 * @typedef {Object} DisTubeOptions
 * @prop {boolean} [emitNewSongOnly=false] `@1.3.0`. If `true`, {@link DisTube#event:playSong} is not emitted when looping a song or next song is the same as the previous one
 * @prop {boolean} [leaveOnEmpty=true] Whether or not leaving voice channel if channel is empty when finish the current song. (Avoid accident leaving)
 * @prop {boolean} [leaveOnFinish=false] Whether or not leaving voice channel when the queue ends.
 * @prop {boolean} [leaveOnStop=true] Whether or not leaving voice channel after using DisTube.stop() function.
 * @prop {boolean} [searchSongs=false] Whether or not searching for multiple songs to select manually, DisTube will play the first result if `false`
 */
const DisTubeOptions = {
  emitNewSongOnly: false,
  leaveOnEmpty: true,
  leaveOnFinish: false,
  leaveOnStop: true,
  searchSongs: false,
};

const ffmpegFilters = {
  "3d": "apulsator=hz=0.125",
  bassboost: 'bass=g=10',
  echo: "aecho=0.8:0.9:1000:0.3",
  karaoke: "stereotools=mlev=0.015625",
  nightcore: "asetrate=44100*1.6,aresample=44100,bass=g=10",
  vaporwave: "asetrate=44100*0.8,aresample=44100,atempo=1.1"
}

/**
 * Class representing a DisTube.
 * @extends EventEmitter
 */
class DisTube extends EventEmitter {
  /**
   * Create new DisTube.
   * @param {Discord.Client} client Discord.JS client
   * @param {DisTubeOptions} [otp={}] Custom DisTube options
   * @example
   * const Discord = require('discord.js'),
   *     DisTube = require('distube'),
   *     client = new Discord.Client(), 
   * // Create a new DisTube
   * const distube = new DisTube(client, { searchSongs: true });
   * // client.DisTube = distube // make it access easily
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
     * List of guild queues
     * @type {Queue[]}
     */
    this.guilds = [];

    /**
     * DisTube options
     * @type {DisTubeOptions}
     */
    this.options = DisTubeOptions;
    for (let key in otp)
      this.options[key] = otp[key];
  }

  /**
   * Play / add a song from Youtube video url or playlist from Youtube playlist url. Search and play a song if it is not a valid url.
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {(string|Song)} song `Youtube url`|`Search string`|`{@link DisTube#Song}`
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
    if (ytpl.validateURL(song))
      this._playlistHandler(message, song);
    else {
      try {
        let resolvedSong;
        if (!ytdl.validateURL(song))
          resolvedSong = await this._searchSong(message, song);
        else if (typeof song === "object") {
          song.user = message.author;
          resolvedSong = song;
        } else {
          let info = await ytdl.getBasicInfo(song);
          resolvedSong = new Song(info, message.author);
        }
        if (this.isPlaying(message)) {
          let queue = this._addToQueue(message, resolvedSong);
          this.emit("addSong", message, queue, queue.songs[queue.songs.length - 1]);
        } else {
          let queue = await this._newQueue(message, resolvedSong);
          this.emit("playSong", message, queue, queue.songs[0]);
        }
      } catch (e) {
        this.emit("error", message, e);
      }
    }
  }

  /**
   * `@2.0.0` Skip the playing song and play a song or a playlist
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {(string|Song)} song `Youtube url`|`Search string`|`{@link DisTube#Song}`
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
    if (ytpl.validateURL(song))
      this._playlistHandler(message, song, true);
    else {
      try {
        let resolvedSong;
        if (!ytdl.validateURL(song))
          resolvedSong = await this._searchSong(message, song);
        else if (typeof song === "object") {
          song.user = message.author;
          resolvedSong = song;
        } else {
          let info = await ytdl.getBasicInfo(song);
          resolvedSong = new Song(info, message.author);
        }
        if (this.isPlaying(message)) {
          this._addToQueue(message, resolvedSong, true);
          this.skip(message);
        } else {
          let queue = await this._newQueue(message, resolvedSong);
          this.emit("playSong", message, queue, queue.songs[0]);
        }
      } catch (e) {
        this.emit("error", message, e);
      }
    }
  }

  /**
   * PLay / add a playlist
   * @async
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   * @param {string} url Youtube playlist url
   */
  async _playlistHandler(message, url, unshift = false) {
    try {
      let playlist = await ytpl(url);
      playlist.user = message.user;
      let videos = playlist.items.map(vid => {
        return {
          ...vid,
          formattedDuration: vid.duration,
          duration: toSecond(vid.duration)
        }
      });
      playlist.duration = videos.reduce((prev, next) => prev + next.duration, 0);
      playlist.formattedDuration = duration(playlist.duration * 1000);
      if (this.isPlaying(message)) {
        let queue = this._addVideosToQueue(message, videos, unshift);
        if (unshift) this.skip(message);
        else this.emit("addList", message, queue, playlist);
      } else {
        let resolvedSong = new Song(videos.shift(), message.author);
        let queue = await this._newQueue(message, resolvedSong).catch((e) => this.emit("error", message, e));
        this._addVideosToQueue(message, videos);
        this.emit("playList", message, queue, playlist, queue.songs[0]);
      }
    } catch (err) {
      this.emit("error", message, err);
    }
  }

  /**
   * `@2.0.0` Search for a song. You can customize how user answers instead of send a number
   * (default of `{@link DisTube#play}()` search when `searchSongs` is `true`).
   * Then use `{@link DisTube#play}(message, aResultToPlay)` or `{@link DisTube#playSkip}()` to play it.
   * @async
   * @param {string} string The string search for
   * @throws {NotFound} If not found
   * @returns {Song[]} Array of results
   */
  async search(string) {
    let search = await ytsr(string, { limit: 12 });
    let videos = search.items.filter(val => val.duration || val.type == 'video');
    if (videos.length == 0) throw Error("NotFound");
    videos = videos.map(video => ytdl.getBasicInfo(video.link));
    videos = await Promise.all(videos);
    let songs = videos.map(video => new Song(video, null));
    return songs;
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
    try {
      let search = await ytsr(name, { limit: 12 });
      let videos = search.items.filter(val => val.duration || val.type == 'video');
      if (videos.length == 0) {
        this.emit("error", message, "Not found!");
        return;
      }
      let song = videos[0];
      if (this.options.searchSongs) {
        try {
          this.emit("searchResult", message, videos);
          let answers = await message.channel.awaitMessages(m => m.author.id === message.author.id, {
            max: 1,
            time: 60000,
            errors: ["time"]
          })
          if (!answers.first()) throw Error();
          let index = parseInt(answers.first().content, 10);
          if (isNaN(index) || index > videos.length || index < 1) {
            this.emit("searchCancel", message);
            return;
          }
          song = videos[index - 1];
        } catch {
          this.emit("searchCancel", message);
        }
      }
      song = await ytdl.getBasicInfo(song.link)
      return new Song(song, message.author);
    } catch (e) {
      this.emit("error", message, e);
    }
  }

  /**
   * Create a new guild queue
   * @async
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   * @param {ytdl.videoInfo} video Song to play
   * @throws {NotInVoice} if user not in a voice channel
   * @returns {Queue}
   */
  async _newQueue(message, song) {
    try {
      let queue = new Queue(message.guild.id);
      this.guilds.push(queue);
      let voice = message.member.voice.channel;
      if (!voice) throw new Error("NotInVoice");
      queue.connection = await voice.join();
      queue.songs.push(song);
      queue.updateDuration();
      this._playSong(message);
      return queue;
    } catch (err) {
      console.error(err);
      this._deleteQueue(message);
    }
  }

  /**
   * Delete a guild queue
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   */
  _deleteQueue(message) {
    this.guilds = this.guilds.filter(guild => guild.id !== message.guild.id);
  }

  /**
   * Get the guild queue
   * @param {Discord.Message} message The message from guild channel
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
    if (!message || !message.guild) throw Error("InvalidDiscordMessage");
    let queue = this.guilds.find(guild => guild.id === message.guild.id);
    return queue;
  }

  /**
   * Add a video to queue
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   * @param {Song} song Song to add
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
    } else queue.songs.push(song);
    queue.updateDuration();
    return queue;
  }

  /**
   * Add a array of videos to queue
   * @private
   * @ignore
   * @param {Discord.Message} message The message from guild channel
   * @param {ytdl.videoInfo[]} videos Array of song to add
   * @returns {Queue}
   */
  _addVideosToQueue(message, videos, unshift = false) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    let songs = videos.map(v => new Song(v, message.author));
    if (unshift) {
      let playing = queue.songs.shift;
      queue.songs.unshift(playing, ...songs);
    } else queue.songs.push(...songs);
    queue.updateDuration();
    return queue;
  }

  /**
   * Pause the guild stream
   * @param {Discord.Message} message The message from guild channel
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
   * @param {Discord.Message} message The message from guild channel
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
   * @param {Discord.Message} message The message from guild channel
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
    queue.dispatcher.end();
    if (this.options.leaveOnStop) queue.connection.channel.leave();
    this._deleteQueue(message);
  }

  /**
   * Set the guild stream's volume
   * @param {Discord.Message} message The message from guild channel
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
   * @param {Discord.Message} message The message from guild channel
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
    if (queue.songs <= 1) throw new Error("NoSong");
    queue.skipped = true;
    queue.dispatcher.end();
    return queue;
  }

  /**
   * Shuffle the guild queue songs
   * @param {Discord.Message} message The message from guild channel
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
   * @param {Discord.Message} message The message from guild channel
   * @param {number} num The song number to play
   * @returns {Queue} The guild queue
   * @throws {InvalidSong} if `num` is invalid number `(0 < num < {@link Queue#songs}.length)`
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
    queue.dispatcher.end();
    return queue;
  }

  /**
   * Set the repeat mode of the guild queue.
   * Turn off if repeat mode is the same value as new mode.
   * Toggle mode: `mode = null` `(0 -> 1 -> 2 -> 0...)`
   * 
   * @param {Discord.Message} message The message from guild channel
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
    if (mode == null) queue.repeatMode = (queue.repeatMode + 1) % 3;
    else if (queue.repeatMode == mode) queue.repeatMode = 0;
    else queue.repeatMode = mode;
    return queue.repeatMode;
  }

  /**
   * Toggle autoplay mode
   * @param {Discord.Message} message The message from guild channel
   * @returns {boolean} Autoplay mode state
   * @throws {NotPlaying} No playing queue
   * @example
   * client.on('message', (message) => {
   *     if (!message.content.startsWith(config.prefix)) return;
   *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
   *     const command = args.shift();
   *     if (command == "autoplay") {
   *         let mode = distube.toggleAutoplay(message);
   *         message.channel.send("Set autoplay mode to `" + mode ? "On" : "Off" + "`");
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
   * Whether or not a guild is playing song(s)
   * @param {Discord.Message} message The message from guild channel to check
   * @returns {boolean} Whether or not the guild is playing song(s)
   */
  isPlaying(message) {
    return this.guilds.some(guild => guild.id === message.guild.id && (guild.playing || !guild.pause));
  }

  /**
   * Whether or not the guild queue is paused
   * @param {Discord.Message} message The message from guild channel to check
   * @returns {boolean} Whether or not the guild queue is paused
   */
  isPaused(message) {
    return this.guilds.some(guild => guild.id === message.guild.id && guild.pause);
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
   * Add related song to the queue
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
   */
  async runAutoplay(message) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    let song = queue.songs[0];
    let related = song.related;
    if (!related) {
      related = await ytdl.getBasicInfo(song.url);
      related = related.related_videos;
    }
    message.autoplay = true;
    related = related.filter(v => v.length_seconds != 'undefined')
    if (related && related[0]) {
      let song = await ytdl.getBasicInfo(related[0].id);
      let nextSong = new Song(song, this.client.user.toString() + " - `Autoplay`");
      this._addToQueue(message, nextSong);
    } else {
      queue.playing = false;
      this.guilds = this.guilds.filter(guild => guild.id !== message.guild.id);
      queue.connection.channel.leave();
      this.emit("noRelated", message);
    }
    return queue;
  }

  /**
   * `@2.0.0` Enable or disable a filter of the queue, replay the playing song.
   * Available filters: `3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`
   * 
   * @param {Discord.Message} message The message from guild channel
   * @param {string} filter A filter name
   * @returns {string} Array of enabled filters.
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
    if (!Object.prototype.hasOwnProperty.call(ffmpegFilters, filter)) throw TypeError("filter must be a Filter (https://DisTube.js.org/global.html#Filter).");
    // Multiple filters
    // if (queue.filters.includes(filter))
    //   queue.filters = queue.filters.filter(f => f != filter);
    // else
    //   queue.filters.push(filter);
    if (queue.filter == filter) queue.filter = null;
    else queue.filter = filter;
    this._playSong(message);
    if (!this.options.emitNewSongOnly) this.emit("playSong", message, queue, queue.songs[0]);
    return queue.filter;
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
    let encoderArgs = queue.filter ? ["-af", ffmpegFilters[queue.filter]] : null;
    let dispatcher = queue.connection.play(ytdl(queue.songs[0].url, {
      opusEncoded: true,
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
      // encoderArgs: ['-af', filters.map(filter => ffmpegFilters[filter]).join(",")]
      encoderArgs
    }), {
      highWaterMark: 1,
      type: 'opus',
      volume: queue.volume / 100
    });
    queue.dispatcher = dispatcher;
    dispatcher
      .on("finish", async () => {
        if (queue.stopped) return;
        if (this._isVoiceChannelEmpty(queue)) {
          if (this.options.leaveOnEmpty) {
            this.guilds = this.guilds.filter(guild => guild.id !== message.guild.id);
            queue.connection.channel.leave();
          }
          return this.emit("empty", message);
        }
        if (queue.repeatMode == 2 && !queue.skipped) queue.songs.push(queue.songs[0]);
        if (queue.songs.length <= 1) {
          if (queue.autoplay) await this.runAutoplay(message);
          else {
            queue.playing = false;
            if (this.options.leaveOnFinish && !queue.stopped) {
              this.guilds = this.guilds.filter(guild => guild.id !== message.guild.id);
              queue.connection.channel.leave();
            }
            return this.emit("finish", message);
          }
        }
        queue.skipped = false;
        let playSongEmit = false;
        if (
          !this.options.emitNewSongOnly || // emitNewSongOnly == false -> emit playSong
          (
            queue.repeatMode != 1 && // Not loop a song
            queue.songs[0].url !== queue.songs[1].url // Not same song
          )
        ) playSongEmit = true;

        if (queue.repeatMode != 1)
          queue.removeFirstSong();
        else queue.updateDuration();
        if (playSongEmit) this.emit("playSong", message, queue, queue.songs[0]);
        return this._playSong(message);
      })
      .on("error", () => {
        this.emit("error", message, "NextSong");
        queue.removeFirstSong();
        if (queue.songs.length > 0) {
          this.emit("playSong", message, queue, queue.songs[0]);
          this._playSong(message);
        }
      });
  }
}

module.exports = DisTube;

/**
 * Youtube playlist author
 * @typedef {Object} ytpl_author
 * @prop {string} id Channel id
 * @prop {string} name Channel name
 * @prop {string} avatar Channel avatar
 * @prop {string} channel_url Channel url
 * @prop {string} user User id
 * @prop {string} user_url User url
 */

/**
 * Youtube playlist item
 * @typedef {Object} ytpl_item
 * @prop {string} id Video id
 * @prop {string} url Video url
 * @prop {string} url_simple Video shorten url
 * @prop {string} title Video title
 * @prop {string} thumbnail Video thumbnail url
 * @prop {string} formattedDuration Video duration `hh:mm:ss`
 * @prop {string} duration Video duration in seconds
 * @prop {ytpl_author} author Video channel
 */

/**
 * Youtube playlist info
 * @typedef {Object} ytpl_result
 * @prop {Discord.User} user `@1.2.0` Requested user
 * @prop {string} id Playlist id
 * @prop {string} url Playlist url
 * @prop {string} title Playlist title
 * @prop {string} formattedDuration Playlist duration `hh:mm:ss`
 * @prop {string} duration Playlist duration in seconds
 * @prop {number} total_items The number of videos in the playlist
 * @prop {ytpl_author} author The playlist creator
 * @prop {ytpl_item[]} items Array of videos
 */

/**
 *  Emitted after DisTube add playlist to guild queue
 *
 * @event DisTube#addList
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {ytpl_result} playlist Playlist info
 * @since 1.1.0
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("addList", (message, queue, playlist) => message.channel.send(
 *     `Added \`${playlist.title}\` playlist (${playlist.total_items} songs) to queue\n${status(queue)}`
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
 * Emitted when there is no user in VoiceChannel.
 * DisTube will leave voice channel if `{@link DisTubeOptions}.leaveOnEmpty` is `true`
 *
 * @event DisTube#empty
 * @param {Discord.Message} message The message from guild channel
 * @example
 * distube.on("empty", message => message.channel.send("Channel is empty. Leaving the channel"))
 */

/**
 * Emitted when `{@link DisTube}` encounters an error.
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
 * DisTube will leave voice channel if `{@link DisTubeOptions}.leaveOnFinish` is `true`
 *
 * @event DisTube#finish
 * @param {Discord.Message} message The message from guild channel
 * @example
 * distube.on("finish", message => message.channel.send("No more song in queue"));
 */

/**
 * Emitted when `{@link Queue#autoplay}` is `true`, the `{@link Queue#songs}` is empty and
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
 * @param {ytpl_result} playlist Playlist info
 * @param {Song} song Playing song
 * @example
 * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
 * distube.on("playList", (message, queue, playlist, song) => message.channel.send(
 *     `Play \`${playlist.title}\` playlist (${playlist.total_items} songs).\nRequested by: ${song.user}\nNow playing \`${song.name}\` - \`${song.formattedDuration}\`\n${status(queue)}`
 * ));
 */

/**
 * Emitted when DisTube play a song.
 * If `{@link DisTubeOptions}.emitNewSongOnly` is `true`, event is not emitted when looping a song or next song is the previous one
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
 * Emitted when `{@link DisTubeOptions}.searchSongs` is `true`.
 * Search will be canceled if user's next message is invalid number or timeout (60s)
 *
 * @event DisTube#searchCancel
 * @param {Discord.Message} message The message from guild channel
 * @example
 * // DisTubeOptions.searchSongs = true
 * distube.on("searchCancel", (message) => message.channel.send(`Searching canceled`));
 */

/**
 * Emitted when `{@link DisTubeOptions}.searchSongs` is `true`.
 * DisTube will wait for user's next message to choose song manually
 * if song param of {@link DisTube#play}() is invalid url
 *
 * @event DisTube#searchResult
 * @param {Discord.Message} message The message from guild channel
 * @param {Song[]} result Searched result (max length = 12)
 * @example
 * // DisTubeOptions.searchSongs = true
 * distube.on("searchResult", (message, result) => {
 *     let i = 0;
 *     message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.title} - \`${song.duration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
 * });
 */