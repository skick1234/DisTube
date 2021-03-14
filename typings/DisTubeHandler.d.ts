export = DisTubeHandler;
declare class DisTubeHandler extends Base {
    constructor(distube: any);
    ytdlOptions: any;
    /**
     * Emit error event
     * @param {Discord.TextChannel} channel Text channel where the error is encountered.
     * @param {Error} error error
     * @private
     */
    private _emitError;
    /**
     * Delete a guild queue
     * @param {Discord.Snowflake|Discord.Message|Queue} queue The message from guild channel | Queue
     */
    deleteQueue(queue: Discord.Snowflake | Discord.Message | Queue): void;
    /**
     * @ignore
     * @param {string} url url
     * @returns {Promise<ytdl.videoInfo>}
     */
    getYouTubeInfo(url: string): Promise<any>;
    /**
     * Resolve a Song
     * @async
     * @param {Discord.Message} message The message from guild channel
     * @param {string|Song} song Youtube url | Search string | {@link Song}
     * @returns {Promise<Song|Song[]>} Resolved Song
     */
    resolveSong(message: Discord.Message, song: string | Song): Promise<Song | Song[]>;
    /**
     * Resole Song[] or url to a Playlist
     * @param {Discord.Message} message The message from guild channel
     * @param {Song[]|string} playlist Resolvable playlist
     * @returns {Playlist}
     */
    resolvePlaylist(message: Discord.Message, playlist: Song[] | string): Playlist;
    /**
     * Search for a song, fire {@link DisTube#event:error} if not found.
     * @async
     * @private
     * @param {Discord.Message} message The message from guild channel
     * @param {string} name The string search for
     * @returns {Song} Song info
     */
    private searchSong;
    /**
     * Join the voice channel
     * @param {Queue} queue The message from guild channel
     * @param {Discord.VoiceChannel} voice The string search for
     * @param {boolean} retried retried?
     * @throws {Error} If an error encountered
     * @returns {Promise<Queue|true>}
     */
    joinVoiceChannel(queue: Queue, voice: Discord.VoiceChannel, retried?: boolean): Promise<Queue | true>;
    /**
     * Get related songs
     * @async
     * @param {Song} song song
     * @returns {ytdl.relatedVideo[]} Related videos
     * @throws {NoRelated}
     */
    getRelatedVideo(song: Song): any[];
    /**
     * Create a ytdl stream
     * @param {Queue} queue Queue
     * @returns {opus.Encoder}
     */
    createStream(queue: Queue): opus.Encoder;
    checkYouTubeInfo(song: any): Promise<void>;
    /**
     * Whether or not emit playSong event
     * @param {Queue} queue Queue
     * @private
     * @returns {boolean}
     */
    private _emitPlaySong;
    /**
     * Play a song on voice connection
     * @param {Queue} queue The guild queue
     * @returns {boolean} error?
     */
    playSong(queue: Queue): boolean;
    /**
     * Handle the queue when a Song finish
     * @private
     * @param {Queue} queue queue
     */
    private _handleSongFinish;
    /**
     * Handle error while playing
     * @private
     * @param {Queue} queue queue
     * @param {Error} error error
     */
    private _handlePlayingError;
}
import Base = require("./DisTubeBase");
import Discord = require("discord.js");
import Queue = require("./Queue");
import Song = require("./Song");
import Playlist = require("./Playlist");
import { opus } from "prism-media";
