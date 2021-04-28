export = Queue;
/**
 * Represents a queue.
 * @extends DisTubeBase
 */
declare class Queue extends DisTubeBase {
    constructor(distube: any, message: any, song: any, textChannel?: any);
    /**
     * Queue id (Guild id)
     * @type {Discord.Snowflake}
     */
    id: Discord.Snowflake;
    /**
     * Stream dispatcher.
     * @type {Discord.StreamDispatcher?}
     */
    dispatcher: Discord.StreamDispatcher | null;
    /**
     * Voice connection.
     * @type {Discord.VoiceConnection?}
     */
    connection: Discord.VoiceConnection | null;
    /**
     * Stream volume. Default value: `50`.
     * @type {number}
     */
    volume: number;
    /**
     * List of songs in the queue (The first one is the playing song)
     * @type {Array<Song>}
     */
    songs: Array<Song>;
    /**
     * List of the previous songs.
     * @type {Array<Song>?}
     */
    previousSongs: Array<Song> | null;
    /**
     * Whether stream is currently stopped.
     * @type {boolean}
     * @private
     */
    private stopped;
    /**
     * Whether or not the last song was skipped to next song.
     * @type {boolean}
     * @private
     */
    private next;
    /**
     * Whether or not the last song was skipped to previous song.
     * @type {boolean}
     * @private
     */
    private prev;
    /**
     * Whether or not the stream is currently playing.
     * @type {boolean}
     */
    playing: boolean;
    /**
     * Pause the guild stream
     * @returns {Queue} The guild queue
     */
    pause(): Queue;
    /**
     * Type of repeat mode (`0` is disabled, `1` is repeating a song, `2` is repeating all the queue).
     * Default value: `0` (disabled)
     * @type {number}
     */
    repeatMode: number;
    /**
     * Whether or not the autoplay mode is enabled.
     * Default value: `false`
     * @type {boolean}
     */
    autoplay: boolean;
    /**
     * Enabled audio filters.
     * Available filters: {@link Filters}
     * @type {Array<string>}
     */
    filters: Array<string>;
    /**
     * Should be an opus stream
     * @type {Readable?}
     * @private
     */
    private stream;
    /**
     * What time in the song to begin (in seconds).
     * @type {number}
     */
    beginTime: number;
    /**
     * The text channel of the Queue. (Default: where the first command is called).
     * @type {Discord.TextChannel?}
     */
    textChannel: Discord.TextChannel | null;
    /**
     * @type {DisTubeHandler}
     * @private
     */
    private handler;
    /**
     * Timeout for checking empty channel
     * @type {NodeJS.Timeout?}
     * @private
     */
    private emptyTimeout;
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
     * What time in the song is playing (in seconds).
     * @type {number}
     */
    get currentTime(): number;
    /**
     * Formatted {@link Queue#currentTime} string.
     * @type {string}
     */
    get formattedCurrentTime(): string;
    /**
     * The voice channel playing in.
     * @type {Discord.VoiceChannel|Discord.StageChannel|null}
     */
    get voiceChannel(): Discord.VoiceChannel | Discord.StageChannel;
    /**
     * Add a Song or an array of Song to the queue
     * @param {Song|Array<Song>} song Song to add
     * @param {boolean} [unshift=false] Unshift?
     * @throws {Error}
     * @returns {Queue}
     */
    addToQueue(song: Song | Array<Song>, unshift?: boolean): Queue;
    /**
     * Resume the guild stream
     * @returns {Queue} The guild queue
     */
    resume(): Queue;
    /**
     * Stop the guild stream
     */
    stop(): void;
    /**
     * Set the guild stream's volume
     * @param {number} percent The percentage of volume you want to set
     * @returns {Queue} The guild queue
     */
    setVolume(percent: number): Queue;
    /**
     * Skip the playing song
     * @returns {Song} The song will skip to
     * @throws {Error}
     */
    skip(): Song;
    /**
     * Play the previous song
     * @returns {Song} The guild queue
     * @throws {Error}
     */
    previous(): Song;
    /**
     * Shuffle the queue's songs
     * @returns {Queue} The guild queue
     */
    shuffle(): Queue;
    /**
     * Jump to the song number in the queue.
     * The next one is 1, 2,...
     * The previous one is -1, -2,...
     * @param {number} num The song number to play
     * @returns {Queue} The guild queue
     * @throws {InvalidSong} if `num` is invalid number (0 < num < {@link Queue#songs}.length)
     */
    jump(num: number): Queue;
    /**
     * Set the repeat mode of the guild queue.
     * Turn off if repeat mode is the same value as new mode.
     * Toggle mode: `mode = null` `(0 -> 1 -> 2 -> 0...)`
     * @param {number?} [mode] The repeat modes `(0: disabled, 1: Repeat a song, 2: Repeat all the queue)`
     * @returns {number} The new repeat mode
     */
    setRepeatMode(mode?: number | null): number;
    /**
     * Enable or disable filter of the queue.
     * Available filters: {@link Filters}
     * @param {string|false} filter A filter name, `false` to clear all the filters
     * @returns {Array<string>} Enabled filters.
     * @throws {Error}
     */
    setFilter(filter: string | false): Array<string>;
    /**
     * Set the playing time to another position
     * @param {number} time Time in seconds
     * @returns {Queue}
     */
    seek(time: number): Queue;
    /**
     * Add a related song to the queue
     * @async
     * @param {Song} [song] A song to get the related one
     * @returns {Promise<Queue>} The guild queue
     * @throws {Error}
     */
    addRelatedVideo(song?: Song): Promise<Queue>;
    /**
     * Toggle autoplay mode
     * @returns {boolean} Autoplay mode state
     */
    toggleAutoplay(): boolean;
}
import DisTubeBase = require("./DisTubeBase");
import Discord = require("discord.js");
import Song = require("./Song");
