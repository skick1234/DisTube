const duration = require("./duration");

/**
 * Represents a queue.
 * @param {Discord.Snowflake} guildID The discord guild ID.
 */
class Queue {
  constructor(guildID) {
    /**
     * The guild ID.
     * @type {Discord.Snowflake}
     */
    this.id = guildID;
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
     * List of songs
     * @type {Song[]}
     */
    this.songs = [];
    /**
     * Queue's duration.
     * @type {Number}
     */
    this.duration = 0;
    /**
     * Formatted duration string.
     * @type {string}
     */
    this.formattedDuration = duration(this.duration * 1000);
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
     * Type of repeat mode (0 is disaled, 1 is repeating a song, 2 is repeating all the playlist)
     * @type {number}
     */
    this.repeatMode = 0;
    /**
     * Whether or not the autoplay mode is enabled.
     * @type {boolean}
     */
    this.autoplay = true;
  }

  removeFirstSong() {
    this.songs.shift();
    this.updateDuration();
  }

  updateDuration() {
    this.duration = this.songs.reduce((prev, next) => prev + next.duration, 0);
    this.formattedDuration = duration(this.duration * 1000);
  }
}

module.exports = Queue;