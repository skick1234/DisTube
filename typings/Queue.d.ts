export = Queue;
/**
 * Represents a queue.
 */
declare class Queue extends Base {
    constructor(distube: any, message: any, song: any);
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
     * @type {Song[]?}
     */
    previousSongs: Song[] | null;
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
     * Type of repeat mode (0 is disabled, 1 is repeating a song, 2 is repeating all the queue)
     * @type {number}
     */
    repeatMode: number;
    /**
     * Whether or not the autoplay mode is enabled.
     * @type {boolean}
     */
    autoplay: boolean;
    /**
     * Enabled audio filters.
     * Available filters: {@link Filter}
     * @type {Filter[]}
     */
    filters: any[];
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
     * @type {Discord.TextChannel}
     */
    textChannel: Discord.TextChannel;
    /**
     * @type {DisTubeHandler}
     * @private
     */
    private handler;
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
     * @type {Discord.VoiceChannel?}
     */
    get voiceChannel(): Discord.VoiceChannel;
    /**
     * Add a Song or an array of Song to the queue
     * @param {Song|Song[]} song Song to add
     * @param {boolean} [unshift=false] Unshift?
     * @throws {Error} If an error encountered
     * @returns {Queue}
     */
    addToQueue(song: Song | Song[], unshift?: boolean): Queue;
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
     * @throws {Error} if there is no song in queue
     */
    skip(): Song;
    /**
     * Play the previous song
     * @returns {Song} The guild queue
     * @throws {Error} if there is no previous song
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
     * Available filters: {@link Filter}
     * @param {Filter|false} filter A filter name, `false` to clear all the filters
     * @returns {string} Current queue's filter name.
     * @throws {Error} If it's not a filter
     */
    setFilter(filter: any | false): string;
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
import Base = require("./DisTubeBase");
import Discord = require("discord.js");
import Song = require("./Song");
