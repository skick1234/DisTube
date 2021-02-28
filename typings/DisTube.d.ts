export = DisTube;
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
     * const distube = new DisTube(client, { searchSongs: true });
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
    /**
     * DisTube filters
     * @type {Filter}
     */
    filters: Filter;
    requestOptions: {
        headers: {
            cookie: string;
            "x-youtube-identity-token": string;
        };
    };
    /**
     * Resolve a Song
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string|Song} song Youtube url | Search string | {@link Song}
     * @private
     * @ignore
     * @returns {Promise<Song|Song[]>} Resolved Song
     */
    private _resolveSong;
    /**
     * Handle a Song or an array of Song
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {Song|SearchResult} song {@link Song} | {@link SearchResult}
     * @private
     * @ignore
     */
    private _handleSong;
    /**
     * Play / add a song or playlist from url. Search and play a song if it is not a valid url.
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string|Song|SearchResult} song Youtube url | Search string | {@link Song} | {@link SearchResult}
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "play")
     *         distube.play(message, args.join(" "));
     * });
     */
    play(message: Discord.Message, song: string | Song | SearchResult): Promise<void>;
    /**
     * `@2.0.0` Skip the playing song and play a song or playlist
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string|Song|SearchResult} song Youtube url | Search string | {@link Song} | {@link SearchResult}
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "playSkip")
     *         distube.playSkip(message, args.join(" "));
     * });
     */
    playSkip(message: Discord.Message, song: string | Song | SearchResult): Promise<void>;
    /**
     * `@2.1.0` Play or add array of Youtube video urls.
     * {@link DisTube#event:playList} or {@link DisTube#event:addList} will be emitted
     * with `playlist`'s properties include `properties` parameter's properties such as
     * `user`, `songs`, `duration`, `formattedDuration`, `thumbnail` like {@link Playlist}
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string[]} urls Array of Youtube url
     * @param {Object} [properties={}] Additional properties such as `name`
     * @param {boolean} [playSkip=false] Whether or not play this playlist instantly
     * @example
     *     let songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
     *     distube.playCustomPlaylist(message, songs, { name: "My playlist name" });
     */
    playCustomPlaylist(message: Discord.Message, urls: string[], properties?: any, playSkip?: boolean): Promise<void>;
    /**
     * PLay / add a playlist
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {string|Song[]|Playlist} arg2 Youtube playlist url | a Playlist
     * @param {boolean} skip Skip the current song
     */
    private _handlePlaylist;
    /**
     * `@2.0.0` Search for a song. You can customize how user answers instead of send a number.
     * Then use {@link DisTube#play|play(message, aResultFromSearch)} or {@link DisTube#playSkip|playSkip()} to play it.
     * @async
     * @param {string} string The string search for
     * @throws {NotFound} If not found
     * @throws {Error} If an error encountered
     * @returns {Promise<SearchResult[]>} Array of results
     */
    search(string: string, retried?: boolean): Promise<SearchResult[]>;
    /**
     * Search for a song, fire {@link DisTube#event:error} if not found.
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {string} name The string search for
     * @returns {Song} Song info
     */
    private _searchSong;
    /**
     * Create a new guild queue
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {Song} song Song to play
     * @throws {NotInVoice} if user not in a voice channel
     * @returns {Promise<Queue>}
     */
    private _newQueue;
    /**
     * Delete a guild queue
     * @private
     * @ignore
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     */
    private _deleteQueue;
    /**
     * Get the guild queue
     * @param {Discord.Snowflake|Discord.Message} message The guild ID or message from guild channel.
     * @returns {Queue} The guild queue
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
     * Add a video to queue
     * @private
     * @ignore
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @param {Song} song Song to add
     * @param {boolean} [unshift=false] Unshift
     * @throws {NotInVoice} if result is empty
     * @returns {Queue}
     */
    private _addToQueue;
    /**
     * Add a array of videos to queue
     * @private
     * @ignore
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @param {Song[]} songs Array of song to add
     * @param {boolean} [unshift=false] Unshift
     * @returns {Queue}
     */
    private _addSongsToQueue;
    /**
     * Pause the guild stream
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     */
    pause(message: Discord.Snowflake | Discord.Message): Queue;
    /**
     * Resume the guild stream
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     */
    resume(message: Discord.Snowflake | Discord.Message): Queue;
    /**
     * Stop the guild stream
     * @param {Discord.Snowflake|Discord.Message} message The message from guild channel
     * @throws {NotPlaying} No playing queue
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
     * The next one is 1,...
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
     * Whether or not the queue's voice channel is empty
     * @private
     * @ignore
     * @param {Queue} queue The guild queue
     * @returns {boolean} No user in voice channel return `true`
     */
    private _isVoiceChannelEmpty;
    /**
     * TODO: Remove this
     * @deprecated use {@link DisTube#addRelatedVideo} instead
     * @param {DisTube.Message} message Message
     * @returns {Promise<Queue>}
     */
    runAutoplay(message: any): Promise<Queue>;
    /**
     * Add related song to the queue
     * @async
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
     * @returns {string} Current queue's filter name.
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if ([`3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`].includes(command)) {
     *         let filter = distube.setFilter(message, command);
     *         message.channel.send("Current queue filter: " + (filter || "Off"));
     *     }
     * });
     */
    setFilter(message: Discord.Message, filter: Filter): string;
    /**
     * `@2.7.0` Set the playing time to another position
     *
     * @param {Discord.Message} message The message from guild channel
     * @param {number} time Time in milliseconds
     * @example
     * client.on('message', message => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command = 'seek')
     *         distube.seek(message, Number(args[0]));
     * });
     */
    seek(message: Discord.Message, time: number): void;
    /**
     * Emit error event
     * @private
     * @ignore
     */
    private _emitError;
    /**
     * Whether or not emit playSong event
     * @private
     * @ignore
     */
    private _emitPlaySong;
    /**
     * Create a ytdl stream
     * @private
     * @ignore
     */
    private _createStream;
    /**
     * Play a song on voice connection
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     */
    private _playSong;
    /**
     * Handle the queue when a Song finish
     * @private
     * @ignore
     * @param {Discord.Message} message message
     * @param {Queue} queue queue
     */
    private _handleSongFinish;
    /**
     * Handle error while playing
     * @private
     * @ignore
     * @param {Discord.Message} message message
     * @param {Queue} queue queue
     * @param {Error} error error
     */
    private _handlePlayingError;
    /**
     *  Emitted after DisTube add playlist to guild queue
     *
     * @event DisTube#addList
     * @param {Discord.Message} message The message from guild channel
     * @param {Queue} queue The guild queue
     * @param {Playlist} playlist Playlist info
     * @since 1.1.0
     * @example
     * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
     * 
     * distube.on("addList", (message, queue, playlist) => message.channel.send(
     *     `Added \`${playlist.name}\` playlist (${playlist.songs.length} songs) to queue\n${status(queue)}`
     * ));
     */
    on(event: "addList", listener: (message: Discord.Message, queue: Queue, playlist: Playlist) => void): this;
    /**
     *  Emitted after DisTube add new song to guild queue
     *
     * @event DisTube#addSong
     * @param {Discord.Message} message The message from guild channel
     * @param {Queue} queue The guild queue
     * @param {Song} song Added song
     * @example
     * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
     * 
     * distube.on("addSong", (message, queue, song) => message.channel.send(
     *     `Added ${song.name} - \`${song.formattedDuration}\` to the queue by ${song.user}`
     * ));
     */
    on(event: "addSong", listener: (message: Discord.Message, queue: Queue, song: Song) => void): this;
    on(event: "empty" | "finish" | "noRelated" | "searchCancel", listener: (message: Discord.Message) => void): this;
    /**
     * Emitted when `DisTube` encounters an error.
     *
     * @event DisTube#error
     * @param {Discord.Message} message The message from guild channel
     * @param {Error} err The error encountered
     * @example
     * distube.on("error", (message, err) => message.channel.send(
     *     "An error encountered: " + err
     * ));
     */
    on(event: "error", listener: (message: Discord.Message, error: Error) => void): this;

    /**
     * Emitted when DisTube initialize a queue to change queue default properties.
     *
     * @event DisTube#initQueue
     * @param {Queue} queue The guild queue
     * @example
     * distube.on("initQueue", queue => {
     *     queue.autoplay = false;
     *     queue.volume = 100;
     * });
     */
    on(event: "initQueue", listener: (queue: Queue) => void): this;

    /**
     * Emitted after DisTube play the first song of the playlist
     * and add the rest to the guild queue
     *
     * @event DisTube#playList
     * @param {Discord.Message} message The message from guild channel
     * @param {Queue} queue The guild queue
     * @param {Playlist} playlist Playlist info
     * @param {Song} song Playing song
     * @example
     * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
     * 
     * distube.on("playList", (message, queue, playlist, song) => message.channel.send(
     *     `Play \`${playlist.name}\` playlist (${playlist.songs.length} songs).\nRequested by: ${song.user}\nNow playing \`${song.name}\` - \`${song.formattedDuration}\`\n${status(queue)}`
     * ));
     */
    on(event: "playList", listener: (message: Discord.Message, queue: Queue, playlist: Playlist, song: Song) => void): this;

    /**
     * Emitted when DisTube play a song.
     * If `DisTubeOptions.emitNewSongOnly` is `true`, event is not emitted when looping a song or next song is the previous one
     *
     * @event DisTube#playSong
     * @param {Discord.Message} message The message from guild channel
     * @param {Queue} queue The guild queue
     * @param {Song} song Playing song
     * @example
     * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
     * 
     * distube.on("playSong", (message, queue, song) => message.channel.send(
     *     `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}\n${status(queue)}`
     * ));
     */
    on(event: "playSong", listener: (message: Discord.Message, queue: Queue, song: Song) => void): this;

    /**
     * Emitted when `DisTubeOptions.searchSongs` is `true`.
     * DisTube will wait for user's next message to choose song manually
     * if song param of DisTube#play() is invalid url
     *
     * @event DisTube#searchResult
     * @param {Discord.Message} message The message from guild channel
     * @param {Song[]} result Searched result (max length = 12)
     * @example
     * // DisTubeOptions.searchSongs = true
     * distube.on("searchResult", (message, result) => {
     *     let i = 0;
     *     message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.title} - \`${song.formattedDuration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
     * });
     */
    on(event: "searchResult", listener: (message: Discord.Message, result: SearchResult[]) => void): this;
}
declare namespace DisTube {
    export { DisTubeOptions, Filter };
}
import { EventEmitter } from "events";
import Discord = require("discord.js");
import Queue = require("./Queue");
import Playlist = require("./Playlist");
declare namespace DisTubeOptions {
    const highWaterMark: number;
    const emitNewSongOnly: boolean;
    const leaveOnEmpty: boolean;
    const leaveOnFinish: boolean;
    const leaveOnStop: boolean;
    const searchSongs: boolean;
    const youtubeCookie: any;
    const youtubeIdentityToken: any;
    const youtubeDL: boolean;
    const updateYouTubeDL: boolean;
    const customFilters: {};
}
/**
 * DisTube audio filters.
 */
type Filter = ("3d" | "bassboost" | "echo" | "karaoke" | "nightcore" | "vaporwave" | "flanger" | "gate" | "haas" | "reverse" | "surround" | "mcompand" | "phaser" | "tremolo" | "earwax" | string);
import Song = require("./Song");
import SearchResult = require("./SearchResult");
/**
 * DisTube options.
 */
type DisTubeOptions = {
    /**
     * `@1.3.0`. If `true`, {@link DisTube#event:playSong} is not emitted when looping a song or next song is the same as the previous one
     */
    emitNewSongOnly?: boolean;
    /**
     * `@2.2.0` ytdl's highWaterMark option.
     */
    highWaterMark?: number;
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
     * Whether or not searching for multiple songs to select manually, DisTube will play the first result if `false`
     */
    searchSongs?: boolean;
    /**
     * `@2.4.0` YouTube cookies. How to get it: {@link https://github.com/fent/node-ytdl-core/blob/784c04eaf9f3cfac0fe0933155adffe0e2e0848a/example/cookies.js#L6-L12|YTDL's Example}
     */
    youtubeCookie?: string;
    /**
     * `@2.4.0` If not given, ytdl-core will try to find it. You can find this by going to a video's watch page, viewing the source, and searching for "ID_TOKEN".
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
     * `@2.7.0` Override or add more ffmpeg filters. Example: `{ "Filter name": "Filter value", "8d": "apulsator=hz=0.075" }`
     */
    customFilters?: {
        [x: string]: string;
    };
};
