const { formatDuration } = require("./util"),
  Song = require("./Song"),
  Base = require("./DisTubeBase"),
  // eslint-disable-next-line no-unused-vars
  Discord = require("discord.js");

/**
 * Represents a queue.
 */
class Queue extends Base {
  constructor(distube, message, song) {
    super(distube);
    /**
     * Queue id (Guild id)
     * @type {Discord.Snowflake}
     */
    this.id = message.guild.id;
    /**
     * Stream dispatcher.
     * @type {Discord.StreamDispatcher?}
     */
    this.dispatcher = null;
    /**
     * Voice connection.
     * @type {Discord.VoiceConnection?}
     */
    this.connection = null;
    /**
     * Stream volume.
     * @type {number}
     */
    this.volume = 50;
    /**
     * List of songs in the queue (The first one is the playing song)
     * @type {Song[]}
     */
    this.songs = [song];
    /**
     * List of the previous songs.
     * @type {Song[]}
     */
    this.previousSongs = [];
    /**
     * Whether stream is currently stopped.
     * @type {boolean}
     * @private
     */
    this.stopped = false;
    /**
     * Whether or not the last song was skipped to next song.
     * @type {boolean}
     * @private
     */
    this.next = false;
    /**
     * Whether or not the last song was skipped to previous song.
     * @type {boolean}
     * @private
     */
    this.previous = false;
    /**
     * Whether or not the stream is currently playing.
     * @type {boolean}
     */
    this.playing = true;
    /**
     * Whether or not the stream is currently paused.
     * @type {boolean}
     */
    this.pause = false;
    /**
     * Type of repeat mode (0 is disabled, 1 is repeating a song, 2 is repeating all the playlist)
     * @type {number}
     */
    this.repeatMode = 0;
    /**
     * Whether or not the autoplay mode is enabled.
     * @type {boolean}
     */
    this.autoplay = false;
    /**
     * Enabled audio filters.
     * Available filters: {@link Filter}
     * @type {Filter[]}
     */
    this.filters = [];
    /**
     * Should be an opus stream
     * @type {Readable?}
     */
    this.stream = null;
    /**
     * What time in the song to begin (in seconds).
     * @type {number}
     */
    this.beginTime = 0;
    /**
     * The text channel of the Queue. (Default: where the first command is called).
     * @type {Discord.TextChannel}
     */
    this.textChannel = message.channel;
  }
  /**
   * Formatted duration string.
   * @type {string}
   */
  get formattedDuration() {
    return formatDuration(this.duration);
  }
  /**
   * Queue's duration.
   * @type {number}
   */
  get duration() {
    return this.songs.length ? this.songs.reduce((prev, next) => prev + next.duration, 0) : 0;
  }
  /**
   * What time in the song is playing (in seconds).
   * @type {number}
   */
  get currentTime() {
    return this.dispatcher ? (this.dispatcher.streamTime / 1000) + this.beginTime : 0;
  }
  /**
   * Formatted {@link Queue#currentTime} string.
   * @type {string}
   */
  get formattedCurrentTime() {
    return formatDuration(this.currentTime);
  }
  /**
   * The voice channel playing in.
   * @type {Discord.VoiceChannel}
   */
  get voiceChannel() {
    return this.connection.voice.channel;
  }
  /**
   * Add a Song or an array of Song to the queue
   * @param {Song|Song[]} song Song to add
   * @param {boolean} [unshift=false] Unshift?
   * @throws {Error} If an error encountered
   * @returns {Queue}
   */
  addToQueue(song, unshift = false) {
    const isArray = Array.isArray(song);
    if (!song && !song.length) throw new Error("No Song provided.");
    if (unshift) {
      const playing = this.songs.shift();
      if (isArray) this.songs.unshift(playing, ...song);
      else this.songs.unshift(playing, song);
    } else if (isArray) this.songs.push(...song);
    else this.songs.push(song);
    return this;
  }
  /**
   * Pause the guild stream
   * @returns {Queue} The guild queue
   */
  pause() {
    this.playing = false;
    this.pause = true;
    this.dispatcher.pause();
    return this;
  }
  /**
   * Resume the guild stream
   * @returns {Queue} The guild queue
   */
  resume() {
    this.playing = true;
    this.pause = false;
    this.dispatcher.resume();
    return this;
  }
  /**
   * Stop the guild stream
   */
  stop() {
    this.stopped = true;
    if (this.dispatcher) try { this.dispatcher.end() } catch { }
    if (this.options.leaveOnStop && this.connection) try { this.connection.channel.leave() } catch { }
  }
  /**
   * Set the guild stream's volume
   * @param {number} percent The percentage of volume you want to set
   * @returns {Queue} The guild queue
   */
  setVolume(percent) {
    this.volume = percent;
    this.dispatcher.setVolume(this.volume / 100);
    return this;
  }

  /**
   * Skip the playing song
   * @returns {Queue} The guild queue
   * @throws {NoSong} if there is no song in queue
   */
  skip() {
    if (this.songs.length <= 1 && !this.autoplay) throw new Error("NoSong");
    this.next = true;
    this.dispatcher.end();
    return this;
  }

  /**
   * Play the previous song
   * @returns {Queue} The guild queue
   * @throws {NoSong} if there is no previous song
   */
  previous() {
    if (this.previousSongs.length === 0) throw new Error("NoSong");
    this.previous = true;
    this.dispatcher.end();
    return this;
  }
  /**
   * Shuffle the queue's songs
   * @returns {Queue} The guild queue
   */
  shuffle() {
    const playing = this.songs.shift();
    for (let i = this.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
    }
    this.songs.unshift(playing);
    return this;
  }
  /**
   * Jump to the song number in the queue.
   * The next one is 1, 2,...
   * The previous one is -1, -2,...
   * @param {number} num The song number to play
   * @returns {Queue} The guild queue
   * @throws {InvalidSong} if `num` is invalid number (0 < num < {@link Queue#songs}.length)
   */
  jump(num) {
    if (num > this.songs.length || -num > this.previousSongs.length || num === 0) throw new RangeError("InvalidSong");
    if (num > 0) {
      this.songs = this.songs.splice(num - 1);
      this.next = true;
    } else if (num === -1) this.previous = true;
    else {
      this.songs.unshift(this.previousSongs.splice(num + 1));
      this.previous = true;
    }
    if (this.dispatcher) this.dispatcher.end();
    return this;
  }
  /**
   * Set the repeat mode of the guild queue.
   * Turn off if repeat mode is the same value as new mode.
   * Toggle mode: `mode = null` `(0 -> 1 -> 2 -> 0...)`
   * @param {number?} [mode] The repeat modes `(0: disabled, 1: Repeat a song, 2: Repeat all the queue)`
   * @returns {number} The new repeat mode
   */
  setRepeatMode(mode = null) {
    mode = parseInt(mode, 10);
    if (!mode && mode !== 0) this.repeatMode = (this.repeatMode + 1) % 3;
    else if (this.repeatMode === mode) this.repeatMode = 0;
    else this.repeatMode = mode;
    return this.repeatMode;
  }
  /**
   * Enable or disable filter(s) of the queue.
   * Available filters: {@link Filter}
   * @param {Filter} filter A filter name
   * @returns {string} Current queue's filter name.
   * @throws {Error} If it's not a filter
   */
  setFilter(filter) {
    if (!Object.prototype.hasOwnProperty.call(this.filters, filter)) throw new TypeError(`${filter} is not a filter name.`);
    if (this.filters.includes(filter)) this.filters = this.filters.filter(f => f !== filter);
    else this.filters.push(filter);
    this.beginTime = this.currentTime;
    this.handler.playSong(this);
    return this.filters;
  }
  /**
   * Set the playing time to another position
   * @param {number} time Time in seconds
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
  seek(time) {
    this.beginTime = time;
    this.handler.playSong(this);
    return this;
  }
  /**
   * Add a related song to the queue
   * @async
   * @param {Song} [song] A song to get the related one
   * @returns {Promise<Queue>} The guild queue
   * @throws {NoRelated}
   */
  async addRelatedVideo(song = this.songs[0]) {
    const related = (await this.handler.getRelatedVideo(song))
      .find(v => !this.previousSongs.map(s => s.id).includes(v.id));
    if (!related) throw new Error("NoRelated");
    this.addToQueue(new Song(await this.handler.getYouTubeInfo(related.id), this.textChannel.guild.me));
    return this;
  }
  /**
   * Toggle autoplay mode
   * @returns {boolean} Autoplay mode state
   */
  toggleAutoplay() {
    this.autoplay = !this.autoplay;
    return this.autoplay;
  }
}

module.exports = Queue;
