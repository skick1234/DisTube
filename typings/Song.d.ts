export = Song;
/** Class representing a song. */
declare class Song {
    constructor(info: any, member?: any, src?: string);
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
     * @type {?ytdl.videoInfo}
     * @private
     */
    private info;
    /**
     * Patch data
     * @param {ytdl.MoreVideoDetails} info Video info
     * @private
     * @ignore
     */
    private _patch;
    /**
     * Youtube video id
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
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
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
     * @type {?string}
     */
    streamURL: string | null;
    /**
     * Song thumbnail.
     * @type {?string}
     */
    thumbnail: string | null;
    /**
     * Related videos (Only available with YouTube video)
     * @type {?ytdl.relatedVideo[]}
     */
    related: ytdl.relatedVideo[] | null;
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
     * @type {object}
     * @prop {?string} name Uploader name
     * @prop {?string} url Uploader url
     */
    uploader: object;
    /**
     * @param {Playlist} playlist Playlist
     * @param {Discord.GuildMember} member User requested
     * @private
     * @returns {Song}
     */
    private _patchPlaylist;
    /**
     * The playlist added this song
     * @type {?Playlist}
     */
    playlist: Playlist | null;
}
import Discord = require("discord.js");
import ytdl = require("ytdl-core");
import Playlist = require("./Playlist");
