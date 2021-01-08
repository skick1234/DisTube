export = Queue;
/**
 * Represents a queue.
 */
declare class Queue {
    /**
    * Create a queue.
    * @param {Discord.Message} message Discord.Message
    * @param {Song} song The first Song of the Queue
    */
    constructor(message: Discord.Message, song: Song);
    /**
     * Stream dispatcher.
     * @type {Discord.StreamDispatcher}
     */
    dispatcher: Discord.StreamDispatcher;
    /**
     * Voice connection.
     * @type {Discord.VoiceConnection}
     */
    connection: Discord.VoiceConnection;
    /**
     * Stream volume.
     * @type {number}
     */
    volume: number;
    /**
     * List of songs in the queue (The first one is the playing song)
     * @type {Song[]}
     */
    songs: Song[];
    /**
     * List of the previous songs.
     * @type {Song[]}
     */
    previousSongs: Song[];
    /**
     * Whether stream is currently stopped.
     * @type {boolean}
     */
    stopped: boolean;
    /**
     * Whether or not the last song was skipped to next song.
     * @type {boolean}
     */
    next: boolean;
    /**
     * Whether or not the last song was skipped to previous song.
     * @type {boolean}
     */
    previous: boolean;
    /**
     * Whether or not the stream is currently playing.
     * @type {boolean}
     */
    playing: boolean;
    /**
     * Whether or not the stream is currently paused.
     * @type {boolean}
     */
    pause: boolean;
    /**
     * Type of repeat mode (0 is disabled, 1 is repeating a song, 2 is repeating all the playlist)
     * @type {number}
     */
    repeatMode: number;
    /**
     * Whether or not the autoplay mode is enabled.
     * @type {boolean}
     */
    autoplay: boolean;
    /**
     * `@2.0.0` Queue audio filter.
     * Available filters: {@link Filter}
     * @type {Filter}
     */
    filter: any;
    /**
     * `@2.5.0` ytdl stream
     * @type {Readable}
     */
    stream: any;
    /**
     * `@2.7.0` What time in the song to begin (in milliseconds).
     * @type {number}
     */
    beginTime: number;
    /**
     * `@3.0.0` The text channel of the Queue. (Default: where the first command is called).
     * @type {Discord.TextChannel}
     */
    textChannel: Discord.TextChannel;
    /**
     * Formatted duration string.
     * @type {string}
     */
    get formattedDuration(): string;
    /**
     * Queue's duration.
     * @type {number}
     */
    get duration(): number;
    /**
     * `@2.7.0` What time in the song is playing (in milliseconds).
     * @type {number}
     */
    get currentTime(): number;
    /**
     * `@2.8.0` Formatted {@link Queue#currentTime} string.
     * @type {string}
     */
    get formattedCurrentTime(): string;
    /**
     * `@3.0.0` The voice channel playing in.
     * @type {Discord.VoiceChannel}
     */
    get voiceChannel(): Discord.VoiceChannel;
}
import Discord = require("discord.js");
import Song = require("./Song");
