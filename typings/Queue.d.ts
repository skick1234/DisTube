export = Queue;
import Discord from "discord.js"
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
    songs: import("./Song")[];
    /**
     * Queue's duration.
     * @type {Number}
     */
    duration: number;
    /**
     * Formatted duration string.
     * @type {string}
     */
    formattedDuration: string;
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
     * Available filters: `3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`
     * @type {string}
     */
    filter: string;
    /**
     * `@2.2.0` Message which initialize the queue
     * @type {Discord.Message}
     */
    initMessage: Discord.Message;
    removeFirstSong(): void;
    updateDuration(): void;
}
