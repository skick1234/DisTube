export = Song;
/** Class representing a song. */
declare class Song {
    /**
     * Create a Song
     * @param {ytdl.videoInfo|Object} info Raw info
     * @param {Discord.GuildMember} member Requested user
     * @param {string} src Song source
     */
    constructor(info: ytdl.videoInfo | any, member?: Discord.GuildMember, src?: string);
    /**
     * The source of the song
     * @type {string}
     */
    source: string;
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
    /**
     * `ytdl-core` raw info (If the song is from YouTube)
     * @type {ytdl.videoInfo?}
     * @private
     */
    private info;
    /**
     * Patch data
     * @param {ytdl.MoreVideoDetails|Object} info Video info
     * @private
     */
    private _patch;
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
     * Related videos (Only available with YouTube video)
     * @type {Array<ytdl.relatedVideo>?}
     */
    related: Array<ytdl.relatedVideo> | null;
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
     * Song repost count
     * @type {number}
     */
    reposts: number;
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
    chapters: Chapter[];
    /**
     * @param {Playlist} playlist Playlist
     * @param {Discord.GuildMember} [member] User requested
     * @private
     * @returns {Song}
     */
    private _patchPlaylist;
    /**
     * The playlist added this song
     * @type {Playlist?}
     */
    playlist: Playlist | null;
}
declare namespace Song {
    export { Chapter };
}
import Discord = require("discord.js");
import ytdl = require("ytdl-core");
type Chapter = {
    /**
     * Chapter title
     */
    title: string;
    /**
     * Chapter start time in seconds
     */
    start_time: number;
};
import Playlist = require("./Playlist");
