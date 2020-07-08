const ytdl = require("discord-ytdl-core"),
  ytsr = require("ytsr"),
  ytpl = require("ytpl"),
  { EventEmitter } = require("events"),
  Queue = require("./Queue"),
  Song = require("./Song");

/**
 * DisTube options.
 * @typedef {Object} DisTubeOptions
 * @prop {boolean} [leaveOnEmpty=true] Whether or not leaving voice channel if it is empty.
 * @prop {boolean} [leaveOnFinish=false] Whether or not leaving voice channel when the queue ends.
 * @prop {boolean} [leaveOnStop=true] Whether or not leaving voice channel after using DisTube.stop() function.
 * @prop {boolean} [searchSongs=false] Whether or not searching for multiple songs to select manually, DisTube will play the first result if `false`
 */
/**
 * Class representing a DisTube.
 * @extends EventEmitter
 */
class DisTube extends EventEmitter {
  /**
   * Create new DisTube.
   * @param {Discord.Client} client Discord.JS client
   * @param {DisTubeOptions} [options={}] Custom DisTube options
   */
  constructor(client, options = {}) {
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
    this.options = {
      leaveOnEmpty: true,
      leaveOnFinish: false,
      leaveOnStop: true,
      searchSongs: false,
    };
    for (let key in options)
      this.options[key] = options[key];
  }

  /**
   * Play / add a song from Youtube video url or playlist from Youtube playlist url.
   * @async
   * @param {Discord.Message} message The message from guild channel
   * @param {string} song `Youtube video url`|`Youtube playlist url`
   */

  /**
   * Search and play a song.
   * 
   * @param {Discord.Message} message The message from guild channel
   * @param {string} song The string to search for
   * @throws {NotInVoice} if user not in a voice channel
   */
  async play(message, song) {
    if (!song) return;
    if (ytpl.validateURL(song))
      this.fetchPlaylist(message, song);
    else {
      if (!ytdl.validateURL(song))
        song = await this.searchSong(message, song).catch((e) => this.emit("error", message, e));
      else song = await ytdl.getBasicInfo(song);
      if (!song) return;
      if (this.isPlaying(message)) {
        let queue = this.addToQueue(message, song);
        this.emit("addSong", message, queue, queue.songs[queue.songs.length - 1]);
      } else {
        let queue = await this.newQueue(message, song).catch((e) => this.emit("error", message, e));
        this.emit("playSong", message, queue, queue.songs[0]);
      }
    }
  }

  async fetchPlaylist(message, url) {
    try {
      let toSecond = (string) => {
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
      let playlist = await ytpl(url);
      let videos = playlist.items.map(vid => {
        return {
          ...vid,
          duration: toSecond(vid.duration)
        }
      });
      if (this.isPlaying()) {
        this.addVideosToQueue(message, videos);
        this.emit("addList", message, playlist);
      } else {
        let queue = await this.newQueue(message, videos.shift()).catch((e) => this.emit("error", message, e));
        this.addVideosToQueue(message, videos);
        this.emit("playList", message, queue, playlist, queue.songs[0]);
      }
    } catch (err) {
      this.emit("error", message, err);
    }
  }

  async searchSong(message, name) {
    try {
      let search = await ytsr(name, {
        limit: 12
      });
      let videos = search.items.filter(val => val.duration || val.type == 'video');
      if (videos.length == 0) throw new Error("Not Found");
      let song = videos[0];
      if (this.options.searchSongs) {
        this.emit("searchResult", message, videos);
        let answers = await message.channel.awaitMessages(m => m.author.id === message.author.id, {
          max: 1,
          time: 60000,
          errors: ["time"]
        }).catch(() => {
          this.emit("searchCancel", message)
          return null;
        });
        let index = parseInt(answers.first().content, 10);
        if (isNaN(index) || index > videos.length || index < 1) {
          this.emit("searchCancel", message);
          return null;
        }
        song = await ytdl.getBasicInfo(videos[index - 1].link);
      }
      return song;
    } catch (e) {
      this.emit("error", message, e);
    }
  }

  async newQueue(message, video) {
    let queue = new Queue(message.guild.id);
    this.guilds.push(queue);
    let voice = message.member.voice.channel;
    if (!voice) throw new Error("NotInVoice");
    queue.connection = await voice.join();
    let song = new Song(video, message.author);
    queue.songs.push(song);
    queue.updateDuration();
    this.playSong(message);
    return queue;
  }

  deleteQueue(message) {
    return this.guilds = this.guilds.filter(guild => guild.id !== message.guild.id);
  }

  /**
   * Get the guild queue
   * @param {Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
   */
  getQueue(message) {
    let queue = this.guilds.find(guild => guild.id === message.guild.id);
    return queue;
  }

  addToQueue(message, video) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    if (!video) throw new Error("NoSong");
    let song = new Song(video, (message.autoplay ? this.client.user.toString() + " - `Autoplay`" : message.author));
    queue.songs.push(song);
    queue.length = queue.songs.reduce((prev, next) => prev + next.duration, 0);
    return queue;
  }

  addVideosToQueue(message, videos) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    videos.forEach(video => {
      let song = new Song(video, message.author);
      queue.songs.push(song);
    });
    queue.length = queue.songs.reduce((prev, next) => prev + next.duration, 0);
    return queue;
  }

  /**
   * Pause the guild stream
   * @param {Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
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
   */
  stop(message) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    queue.stopped = true;
    queue.dispatcher.end();
    if (this.options.leaveOnStop) queue.connection.channel.leave();
    this.guilds = this.guilds.filter(guild => guild.id !== message.guild.id);
  }

  /**
   * Set the guild stream's volume
   * @param {Discord.Message} message The message from guild channel
   * @param {number} percent The percentage of volume you want to set
   * @returns {Queue} The guild queue
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
   * @throws {NoSong} if there is no song in queue
   */
  skip(message) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    if (queue.songs <= 1) throw new Error
    queue.skipped = true;
    queue.dispatcher.end();
    return queue;
  }

  /**
   * Shuffle the guild queue songs
   * @param {Discord.Message} message The message from guild channel
   * @returns {Queue} The guild queue
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
   * Turn off if repeat mode is the same value as type.
   * Toogle mode: `type = null` `(0 -> 1 -> 2 -> 0...)`
   * 
   * @param {Discord.Message} message The message from guild channel
   * @param {number} type The type of repeat mode `(0: disabled, 1: Repeat a song, 2: Repeat all the queue)`
   * @returns {number} Type of repeat mode
   */
  setRepeatMode(message, type = null) {
    let queue = this.getQueue(message);
    if (!queue) throw new Error("NotPlaying");
    if (queue.repeatMode == type) queue.repeatMode = 0;
    else queue.repeatMode = type;
    return queue.repeatMode;
  }

  /**
   * Toggle autoplay Mode
   * @param {Discord.Message} message The message from guild channel
   * @returns {boolean} Autoplay mode state
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

  isVoiceChannelEmpty(queue) {
    let voiceChannel = queue.connection.channel;
    let members = voiceChannel.members.filter(m => !m.user.bot);
    return !members.size;
  }

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
    if (related && related[0]) {
      let nextSong = await ytdl.getBasicInfo(related[0].id);
      this.addToQueue(message, nextSong);
    } else {
      queue.playing = false;
      this.guilds = this.guilds.filter(guild => guild.id !== message.guild.id);
      queue.connection.channel.leave();
      this.emit("noRelated", message);
    }
    return queue;
  }

  async playSong(message) {
    let queue = this.getQueue(message);
    let song = queue.songs[0];
    let dispatcher = queue.connection.play(ytdl(song.url, {
      opusEncoded: true,
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25
    }), {
      highWaterMark: 1,
      type: 'opus',
      bitrate: 'auto'
    });
    queue.dispatcher = dispatcher;
    dispatcher.setVolume(queue.volume / 100);
    dispatcher
      .on("finish", async () => {
        if (this.isVoiceChannelEmpty(queue) && this.options.leaveOnEmpty) {
          this.guilds = this.guilds.filter(guild => guild.id !== message.guild.id);
          queue.connection.channel.leave();
          return this.emit("empty", message);
        }
        if (queue.stopped) return this.emit("stop", message);
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
        if (queue.repeatMode != 1) queue.removeFirstSong();
        else queue.updateDuration();
        this.emit("playSong", message, queue, queue.songs[0]);
        return this.playSong(message);
      })
      .on("error", () => {
        this.emit("error", message, "NextSong");
        queue.removeFirstSong();
        if (queue.songs.length > 0) {
          this.emit("playSong", message, queue, queue.songs[0]);
          this.playSong(message);
        }
      });
  }
}

/**
 * Youtube playlist info
 * @typedef {Object} ytpl_result
 * @prop {string} id Playlist id
 * @prop {string} url Playlist url
 * @prop {string} title Playlist title
 * @prop {number} total_items The number of videos in the playlist
 * @prop {Object} author The playlist creator
 * @prop {Object[]} items Array of videos
 */

/**
 * Youtube search result
 * @typedef {Object} ytsr_result
 * @prop {string} title Video title
 * @prop {string} link Video url
 * @prop {string} thumbnail Video thumbnail url
 * @prop {string} description Video description
 * @prop {string} duration Video duration
 */

/**
 *  Emitted after DisTube add new song to guild queue
 *
 * @event DisTube#addSong
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {Song} song Added song
 */

/**
 *  Emitted when DisTube play a new song
 *
 * @event DisTube#playSong
 * @param {Discord.Message} message The message from guild channel
 * @param {Queue} queue The guild queue
 * @param {Song} song Playing song
 */

/**
 *  Emitted after DisTube add playlist to guild queue
 *
 * @event DisTube#addList
 * @param {Discord.Message} message The message from guild channel
 * @param {ytpl_result} playlist Playlist info
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
 */

/**
 * Emitted when `{@link DisTubeOptions}.searchSongs` is `true` and
 * DisTube will wait for user's next message to choose song manually
 * if song param of {@link DisTube#play}() is not a valid url
 *
 * @event DisTube#searchResult
 * @param {Discord.Message} message The message from guild channel
 * @param {ytsr_result[]} result Searched result (max length = 12)
 */

/**
 * Emitted when `{@link DisTubeOptions}.searchSongs` is `true` and
 * search is canceled if user's next message is invalid number or timeout (60s)
 *
 * @event DisTube#searchCancel
 * @param {Discord.Message} message The message from guild channel
 */

/**
 * Emitted when there is no more song in the queue and {@link Queue#autoplay} is `false`.
 * DisTube will leave voice channel if `{@link DisTubeOptions}.leaveOnFinish` is `true`
 *
 * @event DisTube#finish
 * @param {Discord.Message} message The message from guild channel
 */

/**
 * Emitted when there is no user in VoiceChannel.
 * DisTube will leave voice channel if `{@link DisTubeOptions}.leaveOnEmpty` is `true`
 *
 * @event DisTube#empty
 * @param {Discord.Message} message The message from guild channel
 */

/**
 * Emitted when `{@link Queue}` is stopped by {@link DisTube#stop}().
 * DisTube will leave voice channel if `{@link DisTubeOptions}.leaveOnStop` is `true`
 *
 * @event DisTube#stop
 * @param {Discord.Message} message The message from guild channel
 */

/**
 * Emitted when `{@link Queue#autoplay}` is `true`, the `{@link Queue#songs}` is empty and
 * DisTube cannot find related songs to play
 *
 * @event DisTube#noRelated
 * @param {Discord.Message} message The message from guild channel
 */

/**
 * Emitted when `{@link DisTube}` encounters an error.
 *
 * @event DisTube#error
 * @param {Discord.Message} message The message from guild channel
 * @param {Error} err The error encountered
 */

module.exports = DisTube;