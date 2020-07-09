/// <reference types="discord.js" />
export = Queue;
/**
 * Represents a queue.
 */
declare class Queue {
    /**
    * Create a queue.
    * @param {Discord.Snowflake} guildID The discord guild ID.
    */
    constructor(guildID: string);
    /**
     * The guild ID.
     * @type {Discord.Snowflake}
     */
    id: string;
    /**
     * Stream dispatcher.
     * @type {Discord.StreamDispatcher}
     */
    dispatcher: import("discord.js").StreamDispatcher;
    /**
     * Voice connection.
     * @type {Discord.VoiceConnection}
     */
    connection: import("discord.js").VoiceConnection;
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
     * Type of repeat mode (0 is disaled, 1 is repeating a song, 2 is repeating all the playlist)
     * @type {number}
     */
    repeatMode: number;
    /**
     * Whether or not the autoplay mode is enabled.
     * @type {boolean}
     */
    autoplay: boolean;
    removeFirstSong(): void;
    updateDuration(): void;
}
