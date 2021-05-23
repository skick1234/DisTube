const { formatDuration } = require("./util"),
  Song = require("./Song"),
  DisTubeBase = require("./DisTubeBase"),
  DisTube = require("./DisTube"),
  Discord = require("discord.js"),
  { Readable } = require("stream"),
  DisTubeHandler = require("./DisTubeHandler");

/**
 * Represents a queue.
 * @extends DisTubeBase
 */
class Queue extends DisTubeBase {
  /**
   * Create a queue
   * @param {DisTube} distube DisTube
   * @param {Discord.Message|Discord.VoiceChannel|Discord.StageChannel} message Message
   * @param {Song|Song[]} song First song(s)
   * @param {Discord.TextChannel?} textChannel Default text channel
   */
  constructor(distube, message, song, textChannel = null) {
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
     * Stream volume. Default value: `50`.
     * @type {number}
     */
    this.volume = 50;
    /**
     * List of songs in the queue (The first one is the playing song)
     * @type {Array<Song>}
     */
    this.songs = Array.isArray(song) ? [...song] : [song];
    /**
     * List of the previous songs.
     * @type {Array<Song>?}
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
    this.prev = false;
    /**
     * Whether or not the stream is currently playing.
     * @type {boolean}
     */
    this.playing = true;
    /**
     * Whether or not the stream is currently paused.
     * @type {boolean}
     */
    this.paused = false;
    /**
     * Type of repeat mode (`0` is disabled, `1` is repeating a song, `2` is repeating all the queue).
     * Default value: `0` (disabled)
     * @type {number}
     */
    this.repeatMode = 0;
    /**
     * Whether or not the autoplay mode is enabled.
     * Default value: `false`
     * @type {boolean}
     */
    this.autoplay = false;
    /**
     * Enabled audio filters.
     * Available filters: {@link Filters}
     * @type {Array<string>}
     */
    this.filters = [];
    /**
     * Should be an opus stream
     * @type {Readable?}
     * @private
     */
    this.stream = null;
    /**
     * What time in the song to begin (in seconds).
     * @type {number}
     */
    this.beginTime = 0;
    /**
     * The text channel of the Queue. (Default: where the first command is called).
     * @type {Discord.TextChannel?}
     */
    this.textChannel = message?.channel || textChannel;
    /**
     * @type {DisTubeHandler}
     * @private
     */
    this.handler = this.distube.handler;
    /**
     * Timeout for checking empty channel
     * @type {NodeJS.Timeout?}
     * @private
     */
    this.emptyTimeout = null;
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
   * @type {Discord.VoiceChannel|Discord.StageChannel}
   */
  get voiceChannel() {
    return this.connection?.voice?.channel;
  }
  /**
   * Add a Song or an array of Song to the queue
   * @param {Song|Array<Song>} song Song to add
   * @param {boolean} [unshift=false] Unshift?
   * @throws {Error}
   * @returns {Queue} The guild queue
   */
  addToQueue(song, unshift = false) {
    const isArray = Array.isArray(song);
    if (!song || (isArray && !song.length)) throw new Error("No Song provided.");
    if (unshift) {
      const playing = this.songs.shift();
      if (isArray) this.songs.unshift(playing, ...song);
      else this.songs.unshift(playing, song);
    } else if (isArray) this.songs.push(...song);
    else this.songs.push(song);
    if (isArray) song.map(s => delete s.info);
    else delete song.info;
    return this;
  }
  /**
   * Pause the guild stream
   * @returns {Queue} The guild queue
   */
  pause() {
    this.playing = false;
    this.paused = true;
    this.dispatcher.pause();
    return this;
  }
  /**
   * Resume the guild stream
   * @returns {Queue} The guild queue
   */
  resume() {
    this.playing = true;
    this.paused = false;
    this.dispatcher.resume();
    return this;
  }
  /**
   * Stop the guild stream
   */
  stop() {
    this.stopped = true;
    try { this.dispatcher?.end() } catch { }
    if (this.options.leaveOnStop) try { this.connection?.channel?.leave() } catch { }
  }
  /**
   * Set the guild stream's volume
   * @param {number} percent The percentage of volume you want to set
   * @returns {Queue} The guild queue
   */
  setVolume(percent) {
    if (typeof percent !== "number") throw new Error("Volume percent must be a number.");
    this.volume = percent;
    this.dispatcher.setVolume(this.volume / 100);
    return this;
  }

  /**
   * Skip the playing song
   * @returns {Song} The song will skip to
   * @throws {Error}
   */
  skip() {
    if (this.songs.length <= 1 && !this.autoplay) throw new Error("There is no song to skip.");
    const song = this.songs[1];
    this.next = true;
    this.dispatcher.end();
    return song;
  }

  /**
   * Play the previous song
   * @returns {Song} The guild queue
   * @throws {Error}
   */
  previous() {
    if (!this.options.savePreviousSongs) throw new Error("savePreviousSongs is disabled.");
    if (this.previousSongs?.length === 0 && this.repeatMode !== 2) throw new Error("There is no previous song.");
    const song = this.repeatMode === 2 ? this.songs[this.songs.length - 1] : this.previousSongs[this.previousSongs.length - 1];
    this.prev = true;
    this.dispatcher.end();
    return song;
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
   * @throws {Error} if `num` is invalid number
   */
  jump(num) {
    if (num > this.songs.length || -num > this.previousSongs.length || num === 0) throw new RangeError("InvalidSong");
    if (num > 0) {
      this.songs = this.songs.splice(num - 1);
      this.next = true;
    } else if (!this.distube.options.savePreviousSongs) throw new RangeError("InvalidSong");
    else {
      this.prev = true;
      if (num !== -1) this.songs.unshift(...this.previousSongs.splice(num + 1));
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
   * Enable or disable filter of the queue.
   * Available filters: {@link Filters}
   * @param {string|false} filter A filter name, `false` to clear all the filters
   * @returns {Array<string>} Enabled filters.
   * @throws {Error}
   */
  setFilter(filter) {
    if (filter === false) this.filters = [];
    else if (!Object.prototype.hasOwnProperty.call(this.distube.filters, filter)) throw new TypeError(`${filter} is not a filter name.`);
    else if (this.filters.includes(filter)) this.filters.splice(this.filters.indexOf(filter), 1);
    else this.filters.push(filter);
    this.beginTime = this.currentTime;
    this.handler.playSong(this);
    return this.filters;
  }
  /**
   * Set the playing time to another position
   * @param {number} time Time in seconds
   * @returns {Queue} The guild queue
   */
  seek(time) {
    this.beginTime = time;
    this.handler.playSong(this);
    return this;
  }
  /**
   * Add a related song to the queue
   * @param {Song} [song] A song to get the related one
   * @returns {Promise<Queue>} The guild queue
   * @throws {Error}
   */
  async addRelatedSong(song = this.songs[0]) {
    const related = song.related.find(v => !this.previousSongs.map(s => s.id).includes(v.id));
    if (!related || !(related instanceof Song)) throw new Error("Cannot find any related songs.");
    this.addToQueue(await this.handler.resolveSong(this.voiceChannel?.guild?.me, related.url));
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
