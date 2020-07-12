/// <reference types="discord.js" />
export = DisTube;
declare const DisTube_base: any;
/**
 * DisTube options.
 * @typedef {Object} DisTubeOptions
 * @prop {boolean} [emitNewSongOnly=false] `@1.3.0`. If `true`, {@link DisTube#event:playSong} is not emitted when looping a song or next song is the same as the previous one
 * @prop {boolean} [leaveOnEmpty=true] Whether or not leaving voice channel if it is empty.
 * @prop {boolean} [leaveOnFinish=false] Whether or not leaving voice channel when the queue ends.
 * @prop {boolean} [leaveOnStop=true] Whether or not leaving voice channel after using DisTube.stop() function.
 * @prop {boolean} [searchSongs=false] Whether or not searching for multiple songs to select manually, DisTube will play the first result if `false`
 */
/**
 * Class representing a DisTube.
 * @extends EventEmitter
 */
declare class DisTube extends DisTube_base {
    [x: string]: any;
    /**
     * Create new DisTube.
     * @param {Discord.Client} client Discord.JS client
     * @param {DisTubeOptions} [options={}] Custom DisTube options
     * @example
     * const Discord = require('discord.js'),
     *     DisTube = require('distube'),
     *     client = new Discord.Client(),
     * // Create a new DisTube
     * const distube = new DisTube(client, { searchSongs: true });
     * // client.DisTube = distube // make it access easily
     */
    constructor(client: import("discord.js").Client, options?: DisTubeOptions);
    /**
     * Discord.JS client
     * @type {Discord.Client}
     */
    client: import("discord.js").Client;
    /**
     * List of guild queues
     * @type {Queue[]}
     */
    guilds: import("./Queue")[];
    /**
     * DisTube options
     * @type {DisTubeOptions}
     */
    options: DisTubeOptions;
    /**
     * Play / add a song from Youtube video url or playlist from Youtube playlist url. Search and play a song if it is not a valid url.
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string} string `Youtube video url`|`Youtube playlist url`|`The string to search for`
     * @throws {NotInVoice} if user not in a voice channel
     * @fires DisTube#event:playSong
     * @fires DisTube#event:addSong
     * @fires DisTube#event:playList
     * @fires DisTube#event:addList
     * @throws {NotFound} if result is empty
     * @fires DisTube#event:searchResult
     * @fires DisTube#event:searchCancel
     * @example
     * client.on('message', (message) => {
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "play")
     *         distube.play(message, args.join(" "));
     * });
     */
    play(message: import("discord.js").Message, string: string): Promise<void>;
    /**
     * PLay / add a playlist
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {string} url Youtube playlist url
     * @fires DisTube#event:playList
     * @fires DisTube#event:addList
     */
    private playlistHandler;
    /**
     * Search for a song
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {string} name The string search for
     * @throws {NotFound} if result is empty
     * @fires DisTube#event:searchResult
     * @fires DisTube#event:searchCancel
     * @returns {ytdl.videoInfo} Song info
     */
    private searchSong;
    /**
     * Create a new guild queue
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {ytdl.videoInfo} video Song to play
     * @throws {NotInVoice} if user not in a voice channel
     * @returns {Queue}
     */
    private newQueue;
    /**
     * Delete a guild queue
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     */
    private deleteQueue;
    /**
     * Get the guild queue
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @example
     * client.on('message', (message) => {
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
    getQueue(message: import("discord.js").Message): import("./Queue");
    /**
     * Add a video to queue
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {ytdl.videoInfo} video Song to add
     * @throws {NotInVoice} if result is empty
     * @returns {Queue}
     */
    private addToQueue;
    /**
     * Add a array of videos to queue
     * @async
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @param {ytdl.videoInfo[]} videos Array of song to add
     * @returns {Queue}
     */
    private addVideosToQueue;
    /**
     * Pause the guild stream
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     */
    pause(message: import("discord.js").Message): import("./Queue");
    /**
     * Resume the guild stream
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     */
    resume(message: import("discord.js").Message): import("./Queue");
    /**
     * Stop the guild stream
     * @param {Discord.Message} message The message from guild channel
     * @throws {NotPlaying} No playing queue
     * @example
     * client.on('message', (message) => {
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "stop")
     *         distube.stop(message);
     * });
     */
    stop(message: import("discord.js").Message): void;
    /**
     * Set the guild stream's volume
     * @param {Discord.Message} message The message from guild channel
     * @param {number} percent The percentage of volume you want to set
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     * @example
     * client.on('message', (message) => {
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "volume")
     *         distube.setVolume(message, args[0]);
     * });
     */
    setVolume(message: import("discord.js").Message, percent: number): import("./Queue");
    /**
     * Skip the playing song
     *
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @throws {NotPlaying} No playing queue
     * @throws {NoSong} if there is no song in queue
     * @example
     * client.on('message', (message) => {
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "skip")
     *         distube.skip(message);
     * });
     */
    skip(message: import("discord.js").Message): import("./Queue");
    /**
     * Shuffle the guild queue songs
     * @param {Discord.Message} message The message from guild channel
     * @returns {Queue} The guild queue
     * @example
     * client.on('message', (message) => {
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "shuffle")
     *         distube.shuffle(message);
     * });
     */
    shuffle(message: import("discord.js").Message): import("./Queue");
    /**
     * Jump to the song number in the queue.
     * The next one is 1,...
     * @param {Discord.Message} message The message from guild channel
     * @param {number} num The song number to play
     * @returns {Queue} The guild queue
     * @throws {InvalidSong} if `num` is invalid number `(0 < num < {@link Queue#songs}.length)`
     * @example
     * client.on('message', (message) => {
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "jump")
     *         distube.jump(message, parseInt(args[0]))
     *             .catch(err => message.channel.send("Invalid song number."));
     * });
     */
    jump(message: import("discord.js").Message, num: number): import("./Queue");
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
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "repeat") {
     *         let mode = distube.setRepeatMode(message, parseInt(args[0]));
     *         mode = mode ? mode == 2 ? "Repeat queue" : "Repeat song" : "Off";
     *         message.channel.send("Set repeat mode to `" + mode + "`");
     *     }
     * });
     */
    setRepeatMode(message: import("discord.js").Message, mode?: number): number;
    /**
     * Toggle autoplay Mode
     * @param {Discord.Message} message The message from guild channel
     * @returns {boolean} Autoplay mode state
     * @throws {NotPlaying} No playing queue
     * @example
     * client.on('message', (message) => {
     *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
     *     const command = args.shift();
     *     if (command == "autoplay") {
     *         let mode = distube.toggleAutoplay(message);
     *         message.channel.send("Set autoplay mode to `" + mode ? "On" : "Off" + "`");
     *     }
     * });
     */
    toggleAutoplay(message: import("discord.js").Message): boolean;
    /**
     * Whether or not a guild is playing song(s)
     * @param {Discord.Message} message The message from guild channel to check
     * @returns {boolean} Whether or not the guild is playing song(s)
     */
    isPlaying(message: import("discord.js").Message): boolean;
    /**
     * Whether or not the guild queue is paused
     * @param {Discord.Message} message The message from guild channel to check
     * @returns {boolean} Whether or not the guild queue is paused
     */
    isPaused(message: import("discord.js").Message): boolean;
    /**
     * Whether or not the queue's voice channel is empty
     * @private
     * @ignore
     * @param {Queue} queue The guild queue
     * @returns {boolean} No user in voice channel return `true`
     */
    private isVoiceChannelEmpty;
    /**
     * Play related song
     * @private
     * @ignore
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @fires DisTube#event:playSong
     * @fires DisTube#event:noRelated
     * @returns {Queue} The guild queue
     */
    private runAutoplay;
    /**
     * Play related song
     * @private
     * @ignore
     * @param {Discord.Message} message The message from guild channel
     * @fires DisTube#event:empty
     * @fires DisTube#event:noRelated
     * @fires DisTube#event:stop
     * @fires DisTube#event:finish
     * @fires DisTube#event:error
     */
    private playSong;
}
declare namespace DisTube {
    export { DisTubeOptions, ytpl_author, ytpl_item, ytpl_result, ytsr_result };
}
/**
 * DisTube options.
 */
type DisTubeOptions = {
    /**
     * `@1.3.0`. If `true`, {@link DisTube#event:playSong} is not emitted when looping a song or next song is the same as the previous one
     */
    emitNewSongOnly?: boolean;
    /**
     * Whether or not leaving voice channel if it is empty.
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
     * Video duration (mm:ss)
     */
    duration: string;
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
    user: import("discord.js").User;
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
/**
 * Youtube search result
 */
type ytsr_result = {
    /**
     * Video title
     */
    title: string;
    /**
     * Video url
     */
    link: string;
    /**
     * Video thumbnail url
     */
    thumbnail: string;
    /**
     * Video description
     */
    description: string;
    /**
     * Video duration
     */
    duration: string;
};
