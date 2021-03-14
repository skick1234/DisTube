export = DisTube;
/**
 * @typedef {Object.<string, string>} Filters
 * @ignore
 */
/**
 * DisTube options.
 * @typedef {Object} DisTubeOptions
 * @prop {boolean} [emitNewSongOnly=false] `@1.3.0`. If `true`, {@link DisTube#event:playSong} will not be emitted when looping a song or next song is the same as the previous one
 * @prop {boolean} [leaveOnEmpty=true] Whether or not leaving voice channel if channel is empty in 60s. (Avoid accident leaving)
 * @prop {boolean} [leaveOnFinish=false] Whether or not leaving voice channel when the queue ends.
 * @prop {boolean} [leaveOnStop=true] Whether or not leaving voice channel after using {@link DisTube#stop|stop()} function.
 * @prop {boolean} [savePreviousSongs=true] Whether or not saving the previous songs of the queue and enable {@link DisTube#previous|previous()} method
 * @prop {number} [searchSongs=0] Whether or not searching for multiple songs to select manually; DisTube will play the first result if `false`
 * @prop {string} [youtubeCookie=null] `@2.4.0` YouTube cookies. Read how to get it in {@link https://github.com/fent/node-ytdl-core/blob/997efdd5dd9063363f6ef668bb364e83970756e7/example/cookies.js#L6-L12|YTDL's Example}
 * @prop {string} [youtubeIdentityToken=null] `@2.4.0` If not given; ytdl-core will try to find it. You can find this by going to a video's watch page; viewing the source; and searching for "ID_TOKEN".
 * @prop {boolean} [youtubeDL=true] `@2.8.0` Whether or not using youtube-dl.
 * @prop {boolean} [updateYouTubeDL=true] `@2.8.0` Whether or not updating youtube-dl automatically.
 * @prop {Filters} [customFilters] `@2.7.0` Override {@link DefaultFilters} or add more ffmpeg filters. Example=`{ "Filter name"="Filter value"; "8d"="apulsator=hz=0.075" }`
 * @prop {Object} [ytdlOptions] `@3.0.0` `ytdl-core` options
 * @prop {number} [searchCooldown=60000] Built-in search cooldown in milliseconds (When searchSongs is bigger than 0)
 * @prop {number} [emptyCooldown=60000] Built-in leave on empty cooldown in milliseconds (When leaveOnEmpty is true)
 */
/**
 * Class representing a DisTube.
 * @extends EventEmitter
 */
declare class DisTube extends EventEmitter {
    static get version(): any;
    /**
     * Create new DisTube.
     * @param {Discord.Client} client Discord.JS client
     * @param {DisTubeOptions} [otp={}] Custom DisTube options
     * @example
     * const Discord = require('discord.js'),
     *     DisTube = require('distube'),
     *     client = new Discord.Client();
     * // Create a new DisTube
     * const distube = new DisTube(client, { searchSongs: 10 });
     * // client.DisTube = distube // make it access easily
     * client.login("Your Discord Bot Token")
     */
    constructor(client: Discord.Client, otp?: DisTubeOptions);
    /**
     * DisTube's current version.
     * @type {string}
     * @ignore
     */
    get version(): string;
    /**
     * Discord.JS client
     * @type {Discord.Client}
     */
    client: Discord.Client;
    /**
     * Collection of guild queues
     * @type {Discord.Collection<string, Queue>}
     */
    guildQueues: Discord.Collection<string, Queue>;
    /**
     * DisTube options
     * @type {DisTubeOptions}
     */
    options: DisTubeOptions;
    handler: Handler;
    /**
     * DisTube filters
     * @type {Filters}
     */
    filters: Filters;
    /**
     * Play / add a song or playlist from url. Search and play a song if it is not a valid url.
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string|Song|SearchResult|Playlist} song Youtube url | Search string | {@link Song} | {@link SearchResult} | {@link Playlist}
     * @param {boolean} skip Wether or not skipping the playing song
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "play")
     *         distube.play(message, args.join(" "));
     * });
     */
    play(message: Discord.Message, song: string | Song | SearchResult | Playlist, skip?: boolean): Promise<void>;
    /**
     * `@2.0.0` Skip the playing song and play a song or playlist
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string|Song|SearchResult|Playlist} song Youtube url | Search string | {@link Song} | {@link SearchResult} | {@link Playlist}
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "playSkip")
     *         distube.playSkip(message, args.join(" "));
     * });
     */
    playSkip(message: Discord.Message, song: string | Song | SearchResult | Playlist): Promise<void>;
    /**
     * `@2.1.0` Play or add array of video urls.
     * {@link DisTube#event:playList} or {@link DisTube#event:addList} will be emitted
     * with `playlist`'s properties include `properties` parameter's properties such as
     * `user`, `songs`, `duration`, `formattedDuration`, `thumbnail` like {@link Playlist}
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string[]} songs Array of url
     * @param {Object} [properties={}] Additional properties such as `name`
     * @param {boolean} [playSkip=false] Whether or not play this playlist instantly
     * @param {boolean} [parallel=true] `@3.0.0` Whether or not fetch the playlist in parallel
     * @example
     *     let songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
     *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" });
     *     // Fetching custom playlist sequentially (reduce lag for low specs)
     *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" }, false, false);
     */
    playCustomPlaylist(message: Discord.Message, songs: string[], properties?: any, playSkip?: boolean, parallel?: boolean): Promise<void>;
    /**
     * Play / add a playlist
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {Playlist} playlist Youtube playlist url | a Playlist
     * @param {boolean} skip Skip the current song
     */
    private _handlePlaylist;
    /**
     * `@2.0.0` Search for a song. You can customize how user answers instead of send a number.
     * Then use {@link DisTube#play|play(message, aResultFromSearch)} or {@link DisTube#playSkip|playSkip()} to play it.
     * @async
     * @param {string} string The string search for
     * @param {Object} options Search options
     * @param {number} [options.limit=10] Limit the results
     * @param {"video"|"playlist"} [options.type="video"] Type of search (video or playlist).
     * @param {boolean} retried Retried?
     * @throws {Error} If an error encountered
     * @returns {Promise<SearchResult[]>} Array of results
     */
    search(string: string, options?: {
        limit?: number;
        type?: "video" | "playlist";
    }, retried?: boolean): Promise<SearchResult[]>;
    /**
     * Create a new guild queue
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {Song|Song[]} song Song to play
     * @param {boolean} retried retried?
     * @throws {Error} If an error encountered
     * @returns {Promise<Queue|true>}
     */
    private _newQueue;
    /**
     * Delete a guild queue
     * @ignore
     * @param {Discord.Snowflake|Discord.Message|Queue} queue The message from guild channel | Queue
     */
    deleteQueue(queue: Discord.Snowflake | Discord.Message | Queue): void;
    /**
     * Get the guild queue
     * @param {Discord.Snowflake|Discord.Message} message The guild ID or message from guild channel.
     * @returns {Queue} The guild queue
     * @throws {Error} If an error encountered
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "queue") {
     *         let queue = distube.getQueue(message);
     *         message.channel.send('Current queue:\n' + queue.songs.map((song, id) =>
     *             `**${id+1}**. [${song.name}](${song.url}) - \`${song.formattedDuration}\``
     *         ).join("\n"));
     *     }
     * });
     */
    getQueue(message: Discord.Snowflake | Discord.Message): Queue;
    /**
     * Pause the guild stream
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {Error} If an error encountered
     */
    pause(message: Discord.Snowflake | Discord.Message): Queue;
    /**
     * Resume the guild stream
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {Error} If an error encountered
     */
    resume(message: Discord.Snowflake | Discord.Message): Queue;
    /**
     * Stop the guild stream
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel or Queue
     * @throws {Error} If an error encountered
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "stop") {
     *         distube.stop(message);
     *         message.channel.send("Stopped the queue!");
     *     }
     * });
     */
    stop(message: Discord.Snowflake | Discord.Message): void;
    /**
     * Set the guild stream's volume
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @param {number} percent The percentage of volume you want to set
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "volume")
     *         distube.setVolume(message, args[0]);
     * });
     */
    setVolume(message: Discord.Snowflake | Discord.Message, percent: number): Queue;
    /**
     * Skip the playing song
     *
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     * @throws {NoSong} if there is no song in queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "skip")
     *         distube.skip(message);
     * });
     */
    skip(message: Discord.Snowflake | Discord.Message): Queue;
    /**
     * Play the previous song
     *
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {Disabled} If this method is disabled
     * @throws {NotPlaying} No playing queue
     * @throws {NoSong} if there is no previous song
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "previous")
     *         distube.previous(message);
     * });
     */
    previous(message: Discord.Snowflake | Discord.Message): Queue;
    /**
     * Shuffle the guild queue songs
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "shuffle")
     *         distube.shuffle(message);
     * });
     */
    shuffle(message: Discord.Snowflake | Discord.Message): Queue;
    /**
     * Jump to the song number in the queue.
     * The next one is 1, 2,...
     * The previous one is -1, -2,...
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @param {number} num The song number to play
     * @returns {Queue} The guild queue
     * @throws {InvalidSong} if `num` is invalid number (0 < num < {@link Queue#songs}.length)
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "jump")
     *         distube.jump(message, parseInt(args[0]))
     *             .catch(err => message.channel.send("Invalid song number."));
     * });
     */
    jump(message: Discord.Snowflake | Discord.Message, num: number): Queue;
    /**
     * Set the repeat mode of the guild queue.
     * Turn off if repeat mode is the same value as new mode.
     * Toggle mode: `mode = null` `(0 -> 1 -> 2 -> 0...)`
     *
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @param {number} mode The repeat modes `(0: disabled, 1: Repeat a song, 2: Repeat all the queue)`
     * @returns {number} The new repeat mode
     *
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "repeat") {
     *         let mode = distube.setRepeatMode(message, parseInt(args[0]));
     *         mode = mode ? mode == 2 ? "Repeat queue" : "Repeat song" : "Off";
     *         message.channel.send("Set repeat mode to `" + mode + "`");
     *     }
     * });
     */
    setRepeatMode(message: Discord.Snowflake | Discord.Message, mode?: number): number;
    /**
     * Toggle autoplay mode
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @returns {boolean} Autoplay mode state
     * @throws {NotPlaying} No playing queue
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "autoplay") {
     *         let mode = distube.toggleAutoplay(message);
     *         message.channel.send("Set autoplay mode to `" + (mode ? "On" : "Off") + "`");
     *     }
     * });
     */
    toggleAutoplay(message: Discord.Snowflake | Discord.Message): boolean;
    /**
     * Whether or not a guild is playing music.
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel to check
     * @returns {boolean} Whether or not the guild is playing song(s)
     */
    isPlaying(message: Discord.Snowflake | Discord.Message): boolean;
    /**
     * Whether or not the guild queue is paused
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel to check
     * @returns {boolean} Whether or not the guild queue is paused
     */
    isPaused(message: Discord.Snowflake | Discord.Message): boolean;
    /**
     * Add related song to the queue
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @returns {Promise<Queue>} The guild queue
     */
    addRelatedVideo(message: Discord.Snowflake | Discord.Message): Promise<Queue>;
    /**
     * `@2.0.0` Enable or disable a filter of the queue, replay the playing song.
     * Available filters: {@link Filter}
     *
     * @param {Discord.Message} message The message from guild channel
     * @param {Filter} filter A filter name
     * @returns {Filter[]} Enabled filters.
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if ([`3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`].includes(command)) {
     *         let filter = distube.setFilter(message, command);
     *         message.channel.send("Current queue filter: " + (filter.join(", ") || "Off"));
     *     }
     * });
     */
    setFilter(message: Discord.Message, filter: any): any[];
    /**
     * `@2.7.0` Set the playing time to another position
     * @param {Discord.Message} message The message from guild channel
     * @param {number} time Time in milliseconds
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
    seek(message: Discord.Message, time: number): Queue;
    /**
     * Emit error event
     * @param {Discord.TextChannel} channel Text channel where the error is encountered.
     * @param {Error} error error
     * @ignore
     */
    emitError(channel: Discord.TextChannel, error: Error): void;
}
declare namespace DisTube {
    export { Filters, DisTubeOptions };
}
import { EventEmitter } from "events";
import Discord = require("discord.js");
import Queue = require("./Queue");
/**
 * DisTube options.
 */
type DisTubeOptions = {
    /**
     * `@1.3.0`. If `true`, {@link DisTube#event:playSong} will not be emitted when looping a song or next song is the same as the previous one
     */
    emitNewSongOnly?: boolean;
    /**
     * Whether or not leaving voice channel if channel is empty in 60s. (Avoid accident leaving)
     */
    leaveOnEmpty?: boolean;
    /**
     * Whether or not leaving voice channel when the queue ends.
     */
    leaveOnFinish?: boolean;
    /**
     * Whether or not leaving voice channel after using {@link DisTube#stop|stop()} function.
     */
    leaveOnStop?: boolean;
    /**
     * Whether or not saving the previous songs of the queue and enable {@link DisTube#previous|previous()} method
     */
    savePreviousSongs?: boolean;
    /**
     * Whether or not searching for multiple songs to select manually; DisTube will play the first result if `false`
     */
    searchSongs?: number;
    /**
     * `@2.4.0` YouTube cookies. Read how to get it in {@link https://github.com/fent/node-ytdl-core/blob/997efdd5dd9063363f6ef668bb364e83970756e7/example/cookies.js#L6-L12|YTDL's Example}
     */
    youtubeCookie?: string;
    /**
     * `@2.4.0` If not given; ytdl-core will try to find it. You can find this by going to a video's watch page; viewing the source; and searching for "ID_TOKEN".
     */
    youtubeIdentityToken?: string;
    /**
     * `@2.8.0` Whether or not using youtube-dl.
     */
    youtubeDL?: boolean;
    /**
     * `@2.8.0` Whether or not updating youtube-dl automatically.
     */
    updateYouTubeDL?: boolean;
    /**
     * `@2.7.0` Override {@link DefaultFilters} or add more ffmpeg filters. Example=`{ "Filter name"="Filter value"; "8d"="apulsator=hz=0.075" }`
     */
    customFilters?: Filters;
    /**
     * `@3.0.0` `ytdl-core` options
     */
    ytdlOptions?: any;
    /**
     * Built-in search cooldown in milliseconds (When searchSongs is bigger than 0)
     */
    searchCooldown?: number;
    /**
     * Built-in leave on empty cooldown in milliseconds (When leaveOnEmpty is true)
     */
    emptyCooldown?: number;
};
import Handler = require("./DisTubeHandler");
type Filters = {
    [x: string]: string;
};
import Song = require("./Song");
import SearchResult = require("./SearchResult");
import Playlist = require("./Playlist");
