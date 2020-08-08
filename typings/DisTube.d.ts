/// <reference types="node" />
export = DisTube;
import { EventEmitter } from "events";
import Discord from "discord.js";
import Queue from "./Queue";
import Song from "./Song";
/**
 * Class representing a DisTube.
 * @extends EventEmitter
 */
declare class DisTube extends EventEmitter {
    /**
     * `@2.3.5` DisTube's current version.
     * @type {string}
     * @readonly
     */
    get version(): string;
    /**
     * `@2.2.4` DisTube's current version.
     * @type {string}
     * @readonly
     */
    static get version(): string;
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
     * client.login("Your Discord Bot Token");
     */
    constructor(client: Discord.Client, otp?: DisTubeOptions);
    /**
     * Discord.JS client
     * @type {Discord.Client}
     */
    client: Discord.Client;
    /**
     * Collection of guild queues
     * @type {Map<string, Queue>}
     */
    guildQueues: Map<string, Queue>;
    /**
     * DisTube options
     * @type {DisTubeOptions}
     */
    options: DisTubeOptions;
    /**
     * Play / add a song from Youtube video url or playlist from Youtube playlist url. Search and play a song if it is not a valid url.
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {(string|Song)} song `Youtube url`|`Search string`|`DisTube#Song`
     * @throws {Error} If an error encountered
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "play")
     *         distube.play(message, args.join(" "));
     * });
     */
    play(message: Discord.Message, song: (string | Song)): Promise<void>;
    /**
     * `@2.0.0` Skip the playing song and play a song or a playlist
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {(string|Song)} song `Youtube url`|`Search string`|`DisTube#Song`
     * @throws {Error} If an error encountered
     * @example
     * client.on('message', (message) => {
     *     if (!message.content.startsWith(config.prefix)) return;
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "playSkip")
     *         distube.playSkip(message, args.join(" "));
     * });
     */
    playSkip(message: Discord.Message, song: (string | Song)): Promise<void>;
    /**
     * `@2.1.0` Play or add array of Youtube video urls.
     * `DisTube#event:playList` and `DisTube#event:addList` will be emitted
     * with `playlist`'s properties include `properties` parameter's properties,
     * `user`, `items`, `total_items`, `duration`, `formattedDuration`, `thumbnail` like `ytpl_result`
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string[]} urls Array of Youtube url
     * @param {object} [properties={}] Additional properties such as `title`
     * @param {boolean} [playSkip=false] Weather or not play this playlist instantly
     * @throws {Error} If an error encountered
     * @example
     *     let songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
     *     distube.playCustomPlaylist(message, songs, { title: "My playlist name" });
     */
    playCustomPlaylist(message: Discord.Message, urls: string[], properties?: object, playSkip?: boolean): Promise<void>;
    /**
     * PLay / add a playlist
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {(string|object)} arg2 Youtube playlist url
     */
    private _handlePlaylist;
    /**
     * `@2.0.0` Search for a song. You can customize how user answers instead of send a number
     * (default of `DisTube#play()` search when `searchSongs` is `true`).
     * Then use `DisTube#play(message, aResultToPlay)` or `DisTube#playSkip()` to play it.
     * @async
     * @param {string} string The string search for
     * @throws {NotFound} If not found
     * @throws {Error} If an error encountered
     * @returns {Promise<Song[]>} Array of results
     */
    search(string: string): Promise<Song[]>;
    /**
     * Search for a song, fire `DisTube#event:error` if not found.
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {string} name The string search for
     * @throws {Error}
     * @returns {Song} Song info
     */
    private _searchSong;
    /**
     * Create a new guild queue
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {ytdl.videoInfo} video Song to play
     * @throws {NotInVoice} if user not in a voice channel
     * @returns {Promise<Queue>}
     */
    private _newQueue;
    /**
     * Delete a guild queue
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     */
    private _deleteQueue;
    /**
     * Get the guild queue
     * @param {Discord.Message} message The message from guild channel
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
    getQueue(message: Discord.Message): Queue;
    /**
     * Add a video to queue
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {Song} song Song to add
     * @throws {NotInVoice} if result is empty
     * @returns {Queue}
     */
    private _addToQueue;
    /**
     * Add a array of videos to queue
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {ytdl.videoInfo[]} videos Array of song to add
     * @returns {Queue}
     */
    private _addVideosToQueue;
    /**
     * Pause the guild stream
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     */
    pause(message: Discord.Message): Queue;
    /**
     * Resume the guild stream
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     */
    resume(message: Discord.Message): Queue;
    /**
     * Stop the guild stream
     * @param {Discord.Message} message The message from guild channel
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
    stop(message: Discord.Message): void;
    /**
     * Set the guild stream's volume
     * @param {Discord.Message} message The message from guild channel
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
    setVolume(message: Discord.Message, percent: number): Queue;
    /**
     * Skip the playing song
     *
     * @param {Discord.Message} message The message from guild channel
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
    skip(message: Discord.Message): Queue;
    /**
     * Shuffle the guild queue songs
     * @param {Discord.Message} message The message from guild channel
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
    shuffle(message: Discord.Message): Queue;
    /**
     * Jump to the song number in the queue.
     * The next one is 1,...
     * @param {Discord.Message} message The message from guild channel
     * @param {number} num The song number to play
     * @returns {Queue} The guild queue
     * @throws {InvalidSong} if `num` is invalid number `(0 < num < Queue#songs.length)`
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
    jump(message: Discord.Message, num: number): Queue;
    /**
     * Set the repeat mode of the guild queue.
     * Turn off if repeat mode is the same value as new mode.
     * Toggle mode: `mode = null` `(0 -> 1 -> 2 -> 0...)`
     *
     * @param {Discord.Message} message The message from guild channel
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
    setRepeatMode(message: Discord.Message, mode?: number): number;
    /**
     * Toggle autoplay mode
     * @param {Discord.Message} message The message from guild channel
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
    toggleAutoplay(message: Discord.Message): boolean;
    /**
     * Whether or not a guild is playing or paused music.
     * @param {Discord.Message} message The message from guild channel to check
     * @returns {boolean} Whether or not the guild is playing song(s)
     */
    isPlaying(message: Discord.Message): boolean;
    /**
     * Whether or not the guild queue is paused
     * @param {Discord.Message} message The message from guild channel to check
     * @returns {boolean} Whether or not the guild queue is paused
     */
    isPaused(message: Discord.Message): boolean;
    /**
     * Whether or not the queue's voice channel is empty
     * @private
     * @ignore
     * @param {Queue} queue The guild queue
     * @returns {boolean} No user in voice channel return `true`
     */
    private _isVoiceChannelEmpty;
    /**
     * Add related song to the queue
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @returns {Promise<Queue>} The guild queue
     */
    runAutoplay(message: Discord.Message): Promise<Queue>;
    /**
     * `@2.0.0` Enable or disable a filter of the queue, replay the playing song.
     * Available filters: `3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`
     *
     * @param {Discord.Message} message The message from guild channel
     * @param {string} filter A filter name
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
    setFilter(message: Discord.Message, filter: string): string;
    /**
     * Play a song on voice connection
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     */
    private _playSong;
    /**
     *  Emitted after DisTube add playlist to guild queue
     *
     * @event DisTube#addList
     * @param {Discord.Message} message The message from guild channel
     * @param {Queue} queue The guild queue
     * @param {ytpl_result} playlist Playlist info
     * @since 1.1.0
     * @example
     * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
     * 
     * distube.on("addList", (message, queue, playlist) => message.channel.send(
     *     `Added \`${playlist.title}\` playlist (${playlist.total_items} songs) to queue\n${status(queue)}`
     * ));
     */
    on(event: "addList", listener: (message: Discord.Message, queue: Queue, playlist: ytpl_result) => void): this;
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
     * @param {ytpl_result} playlist Playlist info
     * @param {Song} song Playing song
     * @example
     * const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "Server Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;
     * 
     * distube.on("playList", (message, queue, playlist, song) => message.channel.send(
     *     `Play \`${playlist.title}\` playlist (${playlist.total_items} songs).\nRequested by: ${song.user}\nNow playing \`${song.name}\` - \`${song.formattedDuration}\`\n${status(queue)}`
     * ));
     */
    on(event: "playList", listener: (message: Discord.Message, queue: Queue, playlist: ytpl_result, song: Song) => void): this;

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
     *     message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.title} - \`${song.duration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
     * });
     */
    on(event: "searchResult", listener: (message: Discord.Message, result: Song[]) => void): this;
}
declare namespace DisTube {
    export { DisTubeOptions, ytpl_author, ytpl_item, ytpl_result };
}
declare namespace DisTubeOptions {
    export const emitNewSongOnly: boolean;
    export const leaveOnEmpty: boolean;
    export const leaveOnFinish: boolean;
    export const leaveOnStop: boolean;
    export const searchSongs: boolean;
    export const highWaterMark: number;
}
/**
 * DisTube options.
 */
type DisTubeOptions = {
    /**
     * `@1.3.0`. If `true`, `DisTube#event:playSong` is not emitted when looping a song or next song is the same as the previous one
     */
    emitNewSongOnly?: boolean;
    /**
     * Whether or not leaving voice channel if channel is empty when finish the current song. (Avoid accident leaving)
     */
    leaveOnEmpty?: boolean;
    /**
     * Whether or not leaving voice channel when the queue ends.
     */
    leaveOnFinish?: boolean;
    /**
     * Whether or not leaving voice channel after using DisTube.stop() function.
     */
    leaveOnStop?: boolean;
    /**
     * Whether or not searching for multiple songs to select manually, DisTube will play the first result if `false`
     */
    searchSongs?: boolean;
    /**
     * ytdl's highWaterMark option.
     */
    highWaterMark?: number;
};
/**
 * Youtube playlist author
 */
type ytpl_author = {
    /**
     * Channel id
     */
    id: string;
    /**
     * Channel name
     */
    name: string;
    /**
     * Channel avatar
     */
    avatar: string;
    /**
     * Channel url
     */
    channel_url: string;
    /**
     * User id
     */
    user: string;
    /**
     * User url
     */
    user_url: string;
};
/**
 * Youtube playlist item
 */
type ytpl_item = {
    /**
     * Video id
     */
    id: string;
    /**
     * Video url
     */
    url: string;
    /**
     * Video shorten url
     */
    url_simple: string;
    /**
     * Video title
     */
    title: string;
    /**
     * Video thumbnail url
     */
    thumbnail: string;
    /**
     * Video duration `hh:mm:ss`
     */
    formattedDuration: string;
    /**
     * Video duration in seconds
     */
    duration: number;
    /**
     * Video channel
     */
    author: ytpl_author;
};
/**
 * Youtube playlist info
 */
type ytpl_result = {
    /**
     * `@1.2.0` Requested user
     */
    user: Discord.User;
    /**
     * Playlist id
     */
    id: string;
    /**
     * Playlist url
     */
    url: string;
    /**
     * Playlist title
     */
    title: string;
    /**
     * `@2.1.0` Playlist thumbnail url
     */
    thumbnail: string;
    /**
     * Playlist duration `hh:mm:ss`
     */
    formattedDuration: string;
    /**
     * Playlist duration in seconds
     */
    duration: number;
    /**
     * The number of videos in the playlist
     */
    total_items: number;
    /**
     * The playlist creator
     */
    author: ytpl_author;
    /**
     * Array of videos
     */
    items: ytpl_item[];
};
