/// <reference types="node" />
declare module "duration" {
    function _exports(milliseconds: any): string;
    export = _exports;
}
declare module "Song" {
    export = Song;
    /** Class representing a song. */
    class Song {
        /**
         * Create a song.
         * @param {(ytdl.videoInfo|DisTube.ytpl_item)} video Youtube video info
         * @param {Discord.User} user Requested user
         */
        constructor(video: (import("ytdl-core").videoInfo | import("DisTube").ytpl_item), user: import("discord.js").User);
        /**
         * User requested
         * @type {Discord.User}
         */
        user: import("discord.js").User;
        /**
         * Song name aka video title.
         * @type {string}
         */
        name: string;
        /**
         * Song duration.
         * @type {number}
         */
        duration: number;
        /**
         * Formatted duration string `hh:mm:ss`.
         * @type {string}
         */
        formattedDuration: string;
        /**
         * Video URL.
         * @type {string}
         */
        url: string;
        /**
         * Video thumbnail.
         * @type {string}
         */
        thumbnail: string;
        /**
         * Related videos (for autoplay mode)
         * @type {ytdl.relatedVideo[]}
         */
        related: import("ytdl-core").relatedVideo[];
    }
}
declare module "Queue" {
    export = Queue;
    /**
     * Represents a queue.
     */
    class Queue {
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
        songs: import("Song")[];
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
         * `@v2.0.0` Queue audio filter.
         * Available filters: `3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`
         * @type {string}
         */
        filter: string;
        removeFirstSong(): void;
        updateDuration(): void;
    }
}
declare module "DisTube" {
    export = DisTube;
    const DisTube_base: typeof import("events").EventEmitter;
    /**
     * Class representing a DisTube.
     * @extends EventEmitter
     */
    class DisTube extends DisTube_base {
        /**
         * Create new DisTube.
         * @param {Discord.Client} client Discord.JS client
         * @param {DisTubeOptions} [otp={}] Custom DisTube options
         * @example
         * const Discord = require('discord.js'),
         *     DisTube = require('distube'),
         *     client = new Discord.Client(),
         * // Create a new DisTube
         * const distube = new DisTube(client, { searchSongs: true });
         * // client.DisTube = distube // make it access easily
         */
        constructor(client: import("discord.js").Client, otp?: DisTubeOptions);
        /**
         * Discord.JS client
         * @type {Discord.Client}
         */
        client: import("discord.js").Client;
        /**
         * List of guild queues
         * @type {Queue[]}
         */
        guilds: import("Queue")[];
        /**
         * DisTube options
         * @type {DisTubeOptions}
         */
        options: DisTubeOptions;
        /**
         * Play / add a song from Youtube video url or playlist from Youtube playlist url. Search and play a song if it is not a valid url.
         * @async
         * @param {Discord.Message} message The message from guild channel
         * @param {(string|Song)} song `Youtube url`|`Search string`|`{@link DisTube#Song}`
         * @example
         * client.on('message', (message) => {
         *     if (!message.content.startsWith(config.prefix)) return;
         *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
         *     const command = args.shift();
         *     if (command == "play")
         *         distube.play(message, args.join(" "));
         * });
         */
        play(message: import("discord.js").Message, song: (string | import("Song"))): Promise<void>;
        /**
         * `@2.0.0` Skip the playing song and play a song or a playlist
         * @async
         * @param {Discord.Message} message The message from guild channel
         * @param {(string|Song)} song `Youtube url`|`Search string`|`{@link DisTube#Song}`
         * @example
         * client.on('message', (message) => {
         *     if (!message.content.startsWith(config.prefix)) return;
         *     const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
         *     const command = args.shift();
         *     if (command == "playSkip")
         *         distube.playSkip(message, args.join(" "));
         * });
         */
        playSkip(message: import("discord.js").Message, song: (string | import("Song"))): Promise<void>;
        /**
         * PLay / add a playlist
         * @async
         * @private
         * @ignore
         * @param {Discord.Message} message The message from guild channel
         * @param {string} url Youtube playlist url
         */
        private _playlistHandler;
        /**
         * `@2.0.0` Search for a song. You can customize how user answers instead of send a number
         * (default of `{@link DisTube#play}()` search when `searchSongs` is `true`).
         * Then use `{@link DisTube#play}(message, aResultToPlay)` or `{@link DisTube#playSkip}()` to play it.
         * @async
         * @param {string} string The string search for
         * @throws {NotFound} If not found
         * @returns {Song[]} Array of results
         */
        search(string: string): import("Song")[];
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
         * @param {ytdl.videoInfo} video Song to play
         * @throws {NotInVoice} if user not in a voice channel
         * @returns {Queue}
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
        getQueue(message: import("discord.js").Message): import("Queue");
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
        pause(message: import("discord.js").Message): import("Queue");
        /**
         * Resume the guild stream
         * @param {Discord.Message} message The message from guild channel
         * @returns {Queue} The guild queue
         * @throws {NotPlaying} No playing queue
         */
        resume(message: import("discord.js").Message): import("Queue");
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
        stop(message: import("discord.js").Message): void;
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
        setVolume(message: import("discord.js").Message, percent: number): import("Queue");
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
        skip(message: import("discord.js").Message): import("Queue");
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
        shuffle(message: import("discord.js").Message): import("Queue");
        /**
         * Jump to the song number in the queue.
         * The next one is 1,...
         * @param {Discord.Message} message The message from guild channel
         * @param {number} num The song number to play
         * @returns {Queue} The guild queue
         * @throws {InvalidSong} if `num` is invalid number `(0 < num < {@link Queue#songs}.length)`
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
        jump(message: import("discord.js").Message, num: number): import("Queue");
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
        setRepeatMode(message: import("discord.js").Message, mode?: number): number;
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
        private _isVoiceChannelEmpty;
        /**
         * Add related song to the queue
         * @async
         * @param {Discord.Message} message The message from guild channel
         * @returns {Queue} The guild queue
         */
        runAutoplay(message: import("discord.js").Message): import("Queue");
        /**
         * `@2.0.0` Enable or disable a filter of the queue, replay the playing song.
         * Available filters: `3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`
         *
         * @param {Discord.Message} message The message from guild channel
         * @param {string} filter A filter name
         * @returns {string} Array of enabled filters.
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
        setFilter(message: import("discord.js").Message, filter: string): string;
        /**
         * Play a song on voice connection
         * @private
         * @ignore
         * @param {Discord.Message} message The message from guild channel
         */
        private _playSong;
    }
    namespace DisTube {
        export { DisTubeOptions, ytpl_author, ytpl_item, ytpl_result };
    }
    namespace DisTubeOptions {
        export const emitNewSongOnly: boolean;
        export const leaveOnEmpty: boolean;
        export const leaveOnFinish: boolean;
        export const leaveOnStop: boolean;
        export const searchSongs: boolean;
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
         * Playlist duration `hh:mm:ss`
         */
        formattedDuration: string;
        /**
         * Playlist duration in seconds
         */
        duration: string;
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
}
