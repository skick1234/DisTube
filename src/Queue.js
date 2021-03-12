const { formatDuration } = require("./util");

/**
 * @typedef {import("discord.js").Message} Message
 * @typedef {import("discord.js").Snowflake} Snowflake
 * @typedef {import("discord.js").StreamDispatcher} StreamDispatcher
 * @typedef {import("discord.js").VoiceConnection} VoiceConnection
 * @typedef {import("discord.js").VoiceChannel} VoiceChannel
 * @typedef {import("discord.js").TextChannel} TextChannel
 * @typedef {import("./Song")} Song
 */

/**
 * Represents a queue.
 */
class Queue {
  /**
  * Create a queue.
  * @param {Message} message Discord.Message
  * @param {Song} song The first Song of the Queue
  */
  constructor(message, song) {
    /**
     * `@3.0.0` Queue id (Guild id)
     * @type {Snowflake}
     */
    this.id = message.guild.id;
    /**
     * Stream dispatcher.
     * @type {StreamDispatcher}
     */
    this.dispatcher = null;
    /**
     * Voice connection.
     * @type {VoiceConnection}
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
     */
    this.stopped = false;
    /**
     * Whether or not the last song was skipped to next song.
     * @type {boolean}
     */
    this.next = false;
    /**
     * Whether or not the last song was skipped to previous song.
     * @type {boolean}
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
    this.autoplay = true;
    /**
     * `@2.0.0` Queue audio filter.
     * Available filters: {@link Filter}
     * @type {Filter}
     */
    this.filter = null;
    /**
     * `@2.5.0` ytdl stream
     * @type {Readable}
     */
    this.stream = null;
    /**
     * `@2.7.0` What time in the song to begin (in milliseconds).
     * @type {number}
     */
    this.beginTime = 0;
    /**
     * `@3.0.0` The text channel of the Queue. (Default: where the first command is called).
     * @type {TextChannel}
     */
    this.textChannel = message.channel;
  }
  /**
   * Formatted duration string.
   * @type {string}
   */
  get formattedDuration() {
    return formatDuration(this.duration * 1000);
  }
  /**
   * Queue's duration.
   * @type {number}
   */
  get duration() {
    return this.songs.reduce((prev, next) => prev + next.duration, 0);
  }
  /**
   * `@2.7.0` What time in the song is playing (in milliseconds).
   * @type {number}
   */
  get currentTime() {
    return this.dispatcher.streamTime + this.beginTime;
  }
  /**
   * `@2.8.0` Formatted {@link Queue#currentTime} string.
   * @type {string}
   */
  get formattedCurrentTime() {
    return formatDuration(this.currentTime);
  }
  /**
   * `@3.0.0` The voice channel playing in.
   * @type {VoiceChannel}
   */
  get voiceChannel() {
    return this.connection.voice.channel;
  }
}

module.exports = Queue;
