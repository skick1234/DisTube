export = DisTubeHandler;
/**
 * DisTube's Handler
 * @extends DisTubeBase
 * @private
 */
declare class DisTubeHandler extends DisTubeBase {
    constructor(distube: any);
    ytdlOptions: any;
    /**
     * Emit error event
     * @param {Discord.TextChannel} channel Text channel where the error is encountered.
     * @param {Error} error error
     * @private
     */
    private emitError;
    /**
     * Delete a guild queue
     * @param {Discord.Snowflake|Discord.Message|Queue} queue A message from guild channel | Queue
     */
    deleteQueue(queue: Discord.Snowflake | Discord.Message | Queue): void;
    /**
     * @param {string} url url
     * @returns {Promise<ytdl.videoInfo>}
     */
    getYouTubeInfo(url: string): Promise<any>;
    /**
     * Resolve a Song
     * @async
     * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
     * @param {string|Song|SearchResult|Playlist} song YouTube url | Search string | {@link Song}
     * @returns {Promise<Song|Array<Song>|Playlist>} Resolved Song
     */
    resolveSong(message: Discord.Message | Discord.GuildMember, song: string | Song | SearchResult | Playlist): Promise<Song | Array<Song> | Playlist>;
    /**
     * Resole Song[] or url to a Playlist
     * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
     * @param {Array<Song>|string} playlist Resolvable playlist
     * @returns {Playlist}
     */
    resolvePlaylist(message: Discord.Message | Discord.GuildMember, playlist: Array<Song> | string): Playlist;
    /**
     * Create a custom playlist
     * @async
     * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
     * @param {Array<string|Song|SearchResult>} songs Array of url, Song or SearchResult
     * @param {Object} [properties={}] Additional properties such as `name`
     * @param {boolean} [parallel=true] Whether or not fetch the songs in parallel
     */
    createCustomPlaylist(message: Discord.Message | Discord.GuildMember, songs: Array<string | Song | SearchResult>, properties?: any, parallel?: boolean): Promise<Playlist>;
    /**
     * Play / add a playlist
     * @async
     * @param {Discord.Message|Discord.VoiceChannel|Discord.StageChannel} message A message from guild channel | a voice channel
     * @param {Playlist|string} playlist A YouTube playlist url | a Playlist
     * @param {boolean} [textChannel] The default text channel of the queue
     * @param {boolean} [skip=false] Skip the current song
     */
    handlePlaylist(message: Discord.Message | Discord.VoiceChannel | Discord.StageChannel, playlist: Playlist | string, textChannel?: boolean, skip?: boolean): Promise<void>;
    /**
     * Search for a song, fire {@link DisTube#event:error} if not found.
     * @async
     * @param {Discord.Message} message A message from guild channel
     * @param {string} query The query string
     * @returns {Song?} Song info
     */
    searchSong(message: Discord.Message, query: string): Song | null;
    /**
     * Join the voice channel
     * @param {Queue} queue A message from guild channel
     * @param {Discord.VoiceChannel|Discord.StageChannel} voice The string search for
     * @param {boolean} retried retried?
     * @throws {Error}
     * @returns {Promise<Queue|true>} `true` if queue is not generated
     */
    joinVoiceChannel(queue: Queue, voice: Discord.VoiceChannel | Discord.StageChannel, retried?: boolean): Promise<Queue | true>;
    /**
     * Get related songs
     * @async
     * @param {Song} song song
     * @returns {Array<ytdl.relatedVideo>} Related videos
     * @throws {NoRelated}
     */
    getRelatedVideo(song: Song): Array<any>;
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
    /**
     * Play a song from url without creating a {@link Queue}
     * @param {Discord.VoiceChannel|Discord.StageChannel} voiceChannel The voice channel will be joined
     * @param {string|Song|SearchResult} song YouTube url | {@link Song} | {@link SearchResult}
     * @returns {Promise<Discord.StreamDispatcher>}
     */
    playWithoutQueue(voiceChannel: Discord.VoiceChannel | Discord.StageChannel, song: string | Song | SearchResult): Promise<Discord.StreamDispatcher>;
}
import DisTubeBase = require("./DisTubeBase");
import Discord = require("discord.js");
import Queue = require("./Queue");
import Song = require("./Song");
import SearchResult = require("./SearchResult");
import Playlist = require("./Playlist");
import { opus } from "prism-media";
