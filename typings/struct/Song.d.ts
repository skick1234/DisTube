export = Song;
/**
 * Class representing a song.
 * <info>If {@link Song} is added from a YouTube {@link SearchResult} or {@link Playlist}, some info will be missing to save your resources.
 * It will be filled when emitting {@link DisTube#playSong} event.
 *
 * Missing info: {@link Song#likes}, {@link Song#dislikes}, {@link Song#streamURL}, {@link Song#related}, {@link Song#chapters}, {@link Song#age_restricted}</info>
 */
declare class Song {
    /**
     * Create a Song
     * @param {ytdl.videoInfo|SearchResult|Object} info Raw info
     * @param {Discord.GuildMember} member Requested user
     * @param {string} src Song source
     */
    constructor(info: ytdl.videoInfo | SearchResult | any, member?: Discord.GuildMember, src?: string);
    /**
     * The source of the song
     * @type {string}
     */
    source: string;
    /**
     * Patch data from ytdl-core
     * @param {ytdl.videoInfo|SearchResult} info Video info
     * @private
     */
    private _patchYouTube;
    /**
     * `ytdl-core` raw info (If the song is playing)
     * @type {ytdl.videoInfo?}
     * @private
     */
    private info;
    /**
     * YouTube video id
     * @type {string}
     */
    id: string;
    /**
     * Song name aka video title.
     * @type {string}
     */
    name: string;
    /**
     * Indicates if the video is an active live.
     * @type {boolean}
     */
    isLive: boolean;
    /**
     * Song duration.
     * @type {number}
     */
    duration: number;
    /**
     * Formatted duration string (`hh:mm:ss`, `mm:ss` or `Live`).
     * @type {string}
     */
    formattedDuration: string;
    /**
     * Song URL.
     * @type {string}
     */
    url: string;
    /**
     * Stream / Download URL.
     * @type {string?}
     */
    streamURL: string | null;
    /**
     * Song thumbnail.
     * @type {string?}
     */
    thumbnail: string | null;
    /**
     * Related songs
     * @type {Array<Song>}
     */
    related: Array<Song>;
    /**
     * Song views count
     * @type {number}
     */
    views: number;
    /**
     * Song like count
     * @type {number}
     */
    likes: number;
    /**
     * Song dislike count
     * @type {number}
     */
    dislikes: number;
    /**
     * Song uploader
     * @type {Object}
     * @prop {string?} name Uploader name
     * @prop {string?} url Uploader url
     */
    uploader: any;
    /**
     * Whether or not an age-restricted content
     * @type {boolean}
     */
    age_restricted: boolean;
    /**
     * @typedef {Object} Chapter
     * @prop {string} title Chapter title
     * @prop {number} start_time Chapter start time in seconds
     */
    /**
     * Chapters information (YouTube only)
     * @type {Chapter[]}
     */
    chapters: {
        /**
         * Chapter title
         */
        title: string;
        /**
         * Chapter start time in seconds
         */
        start_time: number;
    }[];
    /**
     * Patch data from other source
     * @param {Object} info Video info
     * @private
     */
    private _patchOther;
    /**
     * Song repost count
     * @type {number}
     */
    reposts: number;
    /**
     * @param {Playlist} playlist Playlist
     * @param {Discord.GuildMember} [member] Requested user
     * @private
     * @returns {Song}
     */
    private _patchPlaylist;
    /**
     * The playlist added this song
     * @type {Playlist?}
     */
    playlist: Playlist | null;
    /**
     * @param {Discord.GuildMember} [member] Requested user
     * @private
     * @returns {Song}
     */
    private _patchMember;
    /**
     * User requested
     * @type {Discord.GuildMember?}
     */
    member: Discord.GuildMember | null;
    /**
     * User requested
     * @type {Discord.User?}
     */
    user: Discord.User | null;
}
import Playlist = require("./Playlist");
import Discord = require("discord.js");
import ytdl = require("ytdl-core");
import SearchResult = require("./SearchResult");
