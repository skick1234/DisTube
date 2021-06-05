export = DisTube;
/**
 * FFmpeg Filters
 * ```
 * {
 *   "Filter Name": "Filter Value",
 *   "bassboost":   "bass=g=10"
 * }
 * ```
 * @typedef {Object.<string, string>} Filters
 * @see {@link DefaultFilters}
 */
/**
 * Data that resolves to give a {@link Queue} object. This can be:
 * - A {@link Queue}
 * - A guild ID string
 * - A {@link https://discord.js.org/#/docs/main/master/class/Snowflake|Snowflake}
 * - A {@link https://discord.js.org/#/docs/main/master/class/Message|Message}
 * - A {@link https://discord.js.org/#/docs/main/master/class/VoiceChannel|VoiceChannel}
 * - A {@link https://discord.js.org/#/docs/main/master/class/StageChannel|StageChannel}
 * - A {@link https://discord.js.org/#/docs/main/master/class/VoiceState|VoiceState}
 * @typedef {Queue|Discord.Snowflake|Discord.Message|Discord.VoiceChannel|Discord.StageChannel|Discord.VoiceState|string} QueueResolvable
 */
/**
 * DisTube options.
 * @typedef {Object} DisTubeOptions
 * @prop {Array<Plugin>} [plugins] DisTube plugins.
 * @prop {boolean} [emitNewSongOnly=false] If `true`, {@link DisTube#event:playSong} will not be emitted when looping a song or next song is the same as the previous one
 * @prop {boolean} [leaveOnEmpty=true] Whether or not leaving voice channel if the voice channel is empty after {@link DisTubeOptions}.emptyCooldown seconds.
 * @prop {boolean} [leaveOnFinish=false] Whether or not leaving voice channel when the queue ends.
 * @prop {boolean} [leaveOnStop=true] Whether or not leaving voice channel after using {@link DisTube#stop|stop()} function.
 * @prop {boolean} [savePreviousSongs=true] Whether or not saving the previous songs of the queue and enable {@link DisTube#previous|previous()} method
 * @prop {number} [searchSongs=0] Limit of search results emits in {@link DisTube#event:searchResult} event when {@link DisTube#play|play()} method executed. If `searchSongs <= 1`, play the first result
 * @prop {string} [youtubeCookie=null] YouTube cookies. Read how to get it in {@link https://github.com/fent/node-ytdl-core/blob/997efdd5dd9063363f6ef668bb364e83970756e7/example/cookies.js#L6-L12|YTDL's Example}
 * @prop {string} [youtubeIdentityToken=null] If not given; ytdl-core will try to find it. You can find this by going to a video's watch page; viewing the source; and searching for "ID_TOKEN".
 * @prop {boolean} [youtubeDL=true] Whether or not using youtube-dl.
 * @prop {boolean} [updateYouTubeDL=true] Whether or not updating youtube-dl automatically.
 * @prop {Filters} [customFilters] Override {@link DefaultFilters} or add more ffmpeg filters. Example=`{ "Filter name"="Filter value"; "8d"="apulsator=hz=0.075" }`
 * @prop {Object} [ytdlOptions] `ytdl-core` options
 * @prop {number} [searchCooldown=60] Built-in search cooldown in seconds (When searchSongs is bigger than 0)
 * @prop {number} [emptyCooldown=60] Built-in leave on empty cooldown in seconds (When leaveOnEmpty is true)
 * @prop {boolean} [nsfw=false] Whether or not playing age-restricted content in non-NSFW channel
 */
/**
 * DisTube class
 * @extends EventEmitter
 */
declare class DisTube extends EventEmitter {
    static get version(): any;
    /**
     * Create a new DisTube class.
     * @param {Discord.Client} client Discord.JS client
     * @param {DisTubeOptions} [otp] Custom DisTube options
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
    /**
     * DisTube's Handler
     * @type {DisTubeHandler}
     * @private
     */
    private handler;
    /**
     * DisTube filters
     * @type {Filters}
     */
    filters: Filters;
    /**
     * Extractor Plugins
     * @type {Array<ExtractorPlugin>}
     * @private
     */
    private extractorPlugins;
    /**
     * Custom Plugins
     * @type {Array<CustomPlugin>}
     * @private
     */
    private customPlugins;
    /**
     * Play / add a song or playlist from url. Search and play a song if it is not a valid url.
     * Emit {@link DisTube#addList}, {@link DisTube#addSong} or {@link DisTube#playSong} after executing
     * @returns {Promise<void>}
     * @param {Discord.Message} message A message from guild channel
     * @param {string|Song|SearchResult|Playlist} song YouTube url | Search string | {@link Song} | {@link SearchResult} | {@link Playlist}
     * @param {Object} [options] Optional options
     * @param {boolean} [options.skip=false] Skip the playing song (if exists) and play the added song/playlist instantly
     * @param {boolean} [options.unshift=false] Add the song/playlist to the beginning of the queue (after the playing song if exists)
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "play")
     *         distube.play(message, args.join(" "));
     * });
     */
    play(message: Discord.Message, song: string | Song | SearchResult | Playlist, options?: {
        skip?: boolean;
        unshift?: boolean;
    }): Promise<void>;
    /**
     * Play / add a song or playlist from url. Search and play a song if it is not a valid url.
     * Emit {@link DisTube#addList}, {@link DisTube#addSong} or {@link DisTube#playSong} after executing
     * @returns {Promise<void>}
     * @param {Discord.VoiceChannel|Discord.StageChannel} voiceChannel The voice channel will be joined
     * @param {string|Song|SearchResult|Playlist} song YouTube url | Search string | {@link Song} | {@link SearchResult} | {@link Playlist}
     * @param {Object} [options] Optional options
     * @param {boolean} [options.skip=false] Skip the playing song (if exists) and play the added song/playlist instantly
     * @param {boolean} [options.unshift=false] Add the song/playlist to the beginning of the queue (after the playing song if exists)
     * @param {Discord.GuildMember} [options.member] Requested user (default is your bot)
     * @param {Discord.TextChannel} [options.textChannel=null] Default {@link Queue#textChannel} (if the queue wasn't created)
     * @param {Discord.Message} [options.message] Called message (For built-in search events. If this is a {@link https://developer.mozilla.org/en-US/docs/Glossary/Falsy|falsy value}, it will play the first result instead)
     */
    playVoiceChannel(voiceChannel: Discord.VoiceChannel | Discord.StageChannel, song: string | Song | SearchResult | Playlist, options?: {
        skip?: boolean;
        unshift?: boolean;
        member?: Discord.GuildMember;
        textChannel?: Discord.TextChannel;
        message?: Discord.Message;
    }): Promise<void>;
    /**
     * Play or add array of video urls.
     * {@link DisTube#event:playSong} or {@link DisTube#event:addList} will be emitted
     * with `playlist`'s properties include `properties` parameter's properties such as
     * `user`, `songs`, `duration`, `formattedDuration`, `thumbnail` like {@link Playlist}
     * @returns {Promise<void>}
     * @param {Discord.Message} message A message from guild channel
     * @param {Array<string|Song|SearchResult>} songs Array of url, Song or SearchResult
     * @param {Object} [properties={}] Additional properties such as `name`
     * @param {Object} [options] Optional options
     * @param {boolean} [options.skip=false] Skip the playing song (if exists) and play the added song/playlist instantly
     * @param {boolean} [options.unshift=false] Add the song/playlist to the beginning of the queue (after the playing song if exists)
     * @param {boolean} [options.parallel=true] Whether or not fetch the songs in parallel
     * @example
     *     let songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
     *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" });
     *     // Fetching custom playlist sequentially (reduce lag for low specs)
     *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" }, false, false);
     */
    playCustomPlaylist(message: Discord.Message, songs: Array<string | Song | SearchResult>, properties?: any, options?: {
        skip?: boolean;
        unshift?: boolean;
        parallel?: boolean;
    }): Promise<void>;
    /**
     * Search for a song.
     * You can customize how user answers instead of send a number.
     * Then use {@link DisTube#play|play(message, aResultFromSearch)} or {@link DisTube#playSkip|playSkip()} to play it.
     * @param {string} string The string search for
     * @param {Object} options Search options
     * @param {number} [options.limit=10] Limit the results
     * @param {'video'|'playlist'} [options.type='video'] Type of search (`video` or `playlist`).
     * @param {boolean} [options.safeSearch=false] Whether or not use safe search (YouTube restricted mode)
     * @throws {Error}
     * @returns {Promise<Array<SearchResult>>} Array of results
     */
    search(string: string, options?: {
        limit?: number;
        type?: 'video' | 'playlist';
        safeSearch?: boolean;
    }): Promise<Array<SearchResult>>;
    /**
     * Create a new guild queue
     * @private
     * @param {Discord.Message|Discord.VoiceChannel|Discord.StageChannel} message A message from guild channel | a voice channel
     * @param {Song|Array<Song>} song Song to play
     * @param {Discord.TextChannel} textChannel A text channel of the queue
     * @throws {Error}
     * @returns {Promise<Queue|true>} `true` if queue is not generated
     */
    private _newQueue;
    /**
     * Delete a guild queue
     * @private
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     */
    private _deleteQueue;
    /**
     * Get the guild queue
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @returns {Queue}
     * @throws {Error}
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "queue") {
     *         const queue = distube.getQueue(message);
     *         message.channel.send('Current queue:\n' + queue.songs.map((song, id) =>
     *             `**${id+1}**. [${song.name}](${song.url}) - \`${song.formattedDuration}\``
     *         ).join("\n"));
     *     }
     * });
     */
    getQueue(queue: QueueResolvable): Queue;
    /**
     * Pause the guild stream
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @returns {Queue} The guild queue
     * @throws {Error}
     */
    pause(queue: QueueResolvable): Queue;
    /**
     * Resume the guild stream
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @returns {Queue} The guild queue
     * @throws {Error}
     */
    resume(queue: QueueResolvable): Queue;
    /**
     * Stop the guild stream
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @throws {Error}
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
    stop(queue: QueueResolvable): void;
    /**
     * Set the guild stream's volume
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @param {number} percent The percentage of volume you want to set
     * @returns {Queue} The guild queue
     * @throws {Error}
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "volume")
     *         distube.setVolume(message, Number(args[0]));
     * });
     */
    setVolume(queue: QueueResolvable, percent: number): Queue;
    /**
     * Skip the playing song
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @returns {Queue} The guild queue
     * @throws {Error}
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "skip")
     *         distube.skip(message);
     * });
     */
    skip(queue: QueueResolvable): Queue;
    /**
     * Play the previous song
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @returns {Queue} The guild queue
     * @throws {Error}
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "previous")
     *         distube.previous(message);
     * });
     */
    previous(queue: QueueResolvable): Queue;
    /**
     * Shuffle the guild queue songs
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
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
    shuffle(queue: QueueResolvable): Queue;
    /**
     * Jump to the song number in the queue.
     * The next one is 1, 2,...
     * The previous one is -1, -2,...
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @param {number} num The song number to play
     * @returns {Queue} The guild queue
     * @throws {Error} if `num` is invalid number (0 < num < {@link Queue#songs}.length)
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
    jump(queue: QueueResolvable, num: number): Queue;
    /**
     * Set the repeat mode of the guild queue.
     * Turn off if repeat mode is the same value as new mode.
     * Toggle mode: `mode = null` `(0 -> 1 -> 2 -> 0...)`
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @param {number} mode The repeat modes `(0: disabled, 1: Repeat a song, 2: Repeat all the queue)`
     * @returns {number} The new repeat mode
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
    setRepeatMode(queue: QueueResolvable, mode?: number): number;
    /**
     * Toggle autoplay mode
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @returns {boolean} Autoplay mode state
     * @throws {Error}
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
    toggleAutoplay(queue: QueueResolvable): boolean;
    /**
     * Add related song to the queue
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @returns {Promise<Queue>} The guild queue
     */
    addRelatedSong(queue: QueueResolvable): Promise<Queue>;
    /**
     * Enable or disable a filter of the queue.
     * Available filters: {@link Filters}
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @param {string|false} filter A filter name, `false` to clear all the filters
     * @returns {Array<string>} Enabled filters.
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
    setFilter(queue: QueueResolvable, filter: string | false): Array<string>;
    /**
     * Set the playing time to another position
     * @param {QueueResolvable} queue The type can be resolved to give a {@link Queue}
     * @param {number} time Time in seconds
     * @returns {Queue} Seeked queue
     * @example
     * client.on('message', message => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command = 'seek')
     *         distube.seek(message, Number(args[0]));
     * });
     */
    seek(queue: QueueResolvable, time: number): Queue;
    /**
     * Emit error event
     * @param {Discord.TextChannel} channel Text channel where the error is encountered.
     * @param {Error} error error
     * @private
     */
    private emitError;
    on(
        event: "addList",
        listener: (queue: Queue, playlist: Playlist) => void
    ): this;
    on(
        event: "addSong" | "playSong" | "finishSong",
        listener: (queue: Queue, song: Song) => void
    ): this;
    on(
        event: "empty" | "finish" | "initQueue" | "noRelated" | "disconnect" | "connect" | "deleteQueue",
        listener: (queue: Queue) => void
    ): this;
    on(
        event: "error",
        listener: (channel: Discord.TextChannel, error: Error) => void
    ): this;
    on(
        event: "searchNoResult" | "searchCancel",
        listener: (message: Discord.Message, query: string) => void
    ): this;
    on(
        event: "searchResult",
        listener: (
            message: Discord.Message,
            results: SearchResult[],
            query: string
        ) => void
    ): this;
    on(
        event: "searchDone",
        listener: (
            message: Discord.Message,
            answer: Discord.Message,
            query: string
        ) => void
    ): this;
}
declare namespace DisTube {
    export { CustomPlugin, ExtractorPlugin, Playlist, Song, Queue, SearchResult, Util, Filters, QueueResolvable, DisTubeOptions };
}
import { EventEmitter } from "events";
import Discord = require("discord.js");
import Queue = require("./struct/Queue");
/**
 * DisTube options.
 */
type DisTubeOptions = {
    /**
     * DisTube plugins.
     */
    plugins?: Array<Plugin>;
    /**
     * If `true`, {@link DisTube #event:playSong} will not be emitted when looping a song or next song is the same as the previous one
     */
    emitNewSongOnly?: boolean;
    /**
     * Whether or not leaving voice channel if the voice channel is empty after {@link DisTubeOptions }.emptyCooldown seconds.
     */
    leaveOnEmpty?: boolean;
    /**
     * Whether or not leaving voice channel when the queue ends.
     */
    leaveOnFinish?: boolean;
    /**
     * Whether or not leaving voice channel after using {@link DisTube #stop|stop()} function.
     */
    leaveOnStop?: boolean;
    /**
     * Whether or not saving the previous songs of the queue and enable {@link DisTube #previous|previous()} method
     */
    savePreviousSongs?: boolean;
    /**
     * Limit of search results emits in {@link DisTube #event:searchResult} event when {@link DisTube #play|play()} method executed. If `searchSongs <= 1`, play the first result
     */
    searchSongs?: number;
    /**
     * YouTube cookies. Read how to get it in {@link https ://github.com/fent/node-ytdl-core/blob/997efdd5dd9063363f6ef668bb364e83970756e7/example/cookies.js#L6-L12|YTDL's Example}
     */
    youtubeCookie?: string;
    /**
     * If not given; ytdl-core will try to find it. You can find this by going to a video's watch page; viewing the source; and searching for "ID_TOKEN".
     */
    youtubeIdentityToken?: string;
    /**
     * Whether or not using youtube-dl.
     */
    youtubeDL?: boolean;
    /**
     * Whether or not updating youtube-dl automatically.
     */
    updateYouTubeDL?: boolean;
    /**
     * Override {@link DefaultFilters } or add more ffmpeg filters. Example=`{ "Filter name"="Filter value"; "8d"="apulsator=hz=0.075" }`
     */
    customFilters?: Filters;
    /**
     * `ytdl-core` options
     */
    ytdlOptions?: any;
    /**
     * Built-in search cooldown in seconds (When searchSongs is bigger than 0)
     */
    searchCooldown?: number;
    /**
     * Built-in leave on empty cooldown in seconds (When leaveOnEmpty is true)
     */
    emptyCooldown?: number;
    /**
     * Whether or not playing age-restricted content in non-NSFW channel
     */
    nsfw?: boolean;
};
/**
 * FFmpeg Filters
 * ```
 * {
 *   "Filter Name": "Filter Value",
 *   "bassboost":   "bass=g=10"
 * }
 * ```
 */
type Filters = {
    [x: string]: string;
};
import Song = require("./struct/Song");
import SearchResult = require("./struct/SearchResult");
import Playlist = require("./struct/Playlist");
/**
 * Data that resolves to give a {@link Queue } object. This can be:
 * - A {@link Queue }
 * - A guild ID string
 * - A {@link https ://discord.js.org/#/docs/main/master/class/Snowflake|Snowflake}
 * - A {@link https ://discord.js.org/#/docs/main/master/class/Message|Message}
 * - A {@link https ://discord.js.org/#/docs/main/master/class/VoiceChannel|VoiceChannel}
 * - A {@link https ://discord.js.org/#/docs/main/master/class/StageChannel|StageChannel}
 * - A {@link https ://discord.js.org/#/docs/main/master/class/VoiceState|VoiceState}
 */
type QueueResolvable = Queue | Discord.Snowflake | Discord.Message | Discord.VoiceChannel | Discord.StageChannel | Discord.VoiceState | string;
import CustomPlugin = require("./struct/CustomPlugin");
import ExtractorPlugin = require("./struct/ExtractorPlugin");
declare var Util: typeof import("./struct/Util");
import Plugin = require("./struct/Plugin");
