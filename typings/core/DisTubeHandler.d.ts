export = DisTubeHandler;
/**
 * DisTube's Handler
 * @extends DisTubeBase
 * @private
 */
declare class DisTubeHandler extends DisTubeBase {
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
     * @param {boolean} [basic=false] getBasicInfo?
     * @returns {Promise<ytdl.videoInfo>}
     */
    getYouTubeInfo(url: string, basic?: boolean): Promise<ytdl.videoInfo>;
    /**
     * Resolve a Song
     * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
     * @param {string|Song|SearchResult|Playlist} song YouTube url | Search string | {@link Song}
     * @returns {Promise<Song|Array<Song>|Playlist>} Resolved Song
     */
    resolveSong(message: Discord.Message | Discord.GuildMember, song: string | Song | SearchResult | Playlist): Promise<Song | Array<Song> | Playlist>;
    /**
     * Resole Song[] or url to a Playlist
     * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
     * @param {Array<Song>|string} playlist Resolvable playlist
     * @param {string} [source="youtube"] Playlist source
     * @returns {Promise<Playlist>}
     */
    resolvePlaylist(message: Discord.Message | Discord.GuildMember, playlist: Array<Song> | string, source?: string): Promise<Playlist>;
    /**
     * Create a custom playlist
     * @returns {Promise<Playlist>}
     * @param {Discord.Message|Discord.GuildMember} message A message from guild channel | A guild member
     * @param {Array<string|Song|SearchResult>} songs Array of url, Song or SearchResult
     * @param {Object} [properties={}] Additional properties such as `name`
     * @param {boolean} [parallel=true] Whether or not fetch the songs in parallel
     */
    createCustomPlaylist(message: Discord.Message | Discord.GuildMember, songs: Array<string | Song | SearchResult>, properties?: any, parallel?: boolean): Promise<Playlist>;
    /**
     * Play / add a playlist
     * @returns {Promise<void>}
     * @param {Discord.Message|Discord.VoiceChannel|Discord.StageChannel} message A message from guild channel | a voice channel
     * @param {Playlist|string} playlist A YouTube playlist url | a Playlist
     * @param {boolean} [textChannel] The default text channel of the queue
     * @param {boolean} [skip=false] Skip the playing song (if exists) and play the added playlist instantly
     * @param {boolean} [unshift=false] Add the playlist to the beginning of the queue (after the playing song if exists)
     */
    handlePlaylist(message: Discord.Message | Discord.VoiceChannel | Discord.StageChannel, playlist: Playlist | string, textChannel?: boolean, skip?: boolean, unshift?: boolean): Promise<void>;
    /**
     * Search for a song, fire {@link DisTube#event:error} if not found.
     * @param {Discord.Message} message A message from guild channel
     * @param {string} query The query string
     * @returns {Promise<Song?>} Song info
     */
    searchSong(message: Discord.Message, query: string): Promise<Song | null>;
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
     * Create a ytdl stream
     * @param {Queue} queue Queue
     * @returns {Transform}
     */
    createStream(queue: Queue): Transform;
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
     * @returns {Promise<boolean>} error?
     */
    playSong(queue: Queue): Promise<boolean>;
    /**
     * Handle the queue when a Song finish
     * @private
     * @param {Queue} queue queue
     * @returns {Promise<void>}
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
     * Check if the voice channel is empty
     * @param {Discord.VoiceState} voiceState voiceState
     * @returns {boolean}
     */
    isVoiceChannelEmpty(voiceState: Discord.VoiceState): boolean;
}
import DisTubeBase = require("./DisTubeBase");
import Discord = require("discord.js");
import Queue = require("../struct/Queue");
import ytdl = require("ytdl-core");
import Song = require("../struct/Song");
import SearchResult = require("../struct/SearchResult");
import Playlist = require("../struct/Playlist");
import { Transform } from "stream";
