export = Queue;
import Discord from "discord.js";
import DisTube from "./DisTube";
import Song from "./Song";
/**
 * Represents a queue.
 */
declare class Queue {
    /**
    * Create a queue.
    */
    constructor(message: any);
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
     * List of songs
     * @type {Song[]}
     */
    songs: Song[];
    /**
     * Whether stream is currently stopped.
     * @type {boolean}
     */
    stopped: boolean;
    /**
     * Whether or not the last song was skipped.
     * @type {boolean}
     */
    skipped: boolean;
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
     * @type {DisTube.Filter}
     */
    filter: DisTube.Filter;
    /**
     * `@2.2.0` Message which initialize the queue
     * @type {Discord.Message}
     */
    initMessage: Discord.Message;
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
    get currentTime(): number
    /**
     * `@3.0.0` Formatted {@link Queue#currentTime} string.
     * @type {string}
     */
    get formattedCurrentTime(): string
}
