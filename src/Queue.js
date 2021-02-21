/* eslint no-unused-vars: "off" */
const { formatDuration } = require("./duration"),
  Discord = require("discord.js"),
  Song = require("./Song"),
  DisTube = require("./DisTube");

/**
 * Represents a queue.
 */
class Queue {
  /**
  * Create a queue.
  * @param {Discord.Message} message Discord.Message
  * @param {Song} song The first Song of the Queue
  */
  constructor(message, song) {
    /**
     * Stream dispatcher.
     * @type {Discord.StreamDispatcher}
     */
    this.dispatcher = null;
    /**
     * Voice connection.
     * @type {Discord.VoiceConnection}
     */
    this.connection = null;
    /**
     * Stream volume.
     * @type {number}
     */
    this.volume = 50;
    /**
     * List of songs
     * @type {Song[]}
     */
    this.songs = [song];
    /**
     * Whether stream is currently stopped.
     * @type {boolean}
     */
    this.stopped = false;
    /**
     * Whether or not the last song was skipped.
     * @type {boolean}
     */
    this.skipped = false;
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
     * @type {DisTube.Filter}
     */
    this.filter = null;
    /**
     * `@2.2.0` Message which initialize the queue
     * @type {Discord.Message}
     */
    this.initMessage = message;
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
  }
  /**
   * Formatted duration string.
   * @type {string}
   */
  get formattedDuration() {
    return formatDuration(this.duration * 1000)
  }
  /**
   * Queue's duration.
   * @type {number}
   */
  get duration() {
    return this.songs.reduce((prev, next) => prev + next.duration, 0)
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
}

module.exports = Queue;
