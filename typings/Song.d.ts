export = Song;
/** Class representing a song. */
declare class Song {
    /**
     * Create a song.
     * @param {ytdl.videoInfo|Object} info Video info
     * @param {Discord.GuildMember} member Requested user
     * @param {string} [src="youtube"] Weather or not the video is a Youtube video.
     */
    constructor(info: ytdl.videoInfo | any, member: Discord.GuildMember, src?: string);
    /**
     * `@3.0.0` The source of the song
     * @type {string}
     */
    source: string;
    /**
     * User requested
     * @type {Discord.GuildMember}
     */
    member: Discord.GuildMember;
    /**
     * User requested
     * @type {Discord.User}
     */
    user: Discord.User;
    /**
     * `@3.0.0` `ytdl-core` raw info (If the song is from YouTube)
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
     * `@2.1.4` Youtube video id
     * @type {string}
     */
    id: string;
    /**
     * Song name aka video title.
     * @type {string}
     */
    name: string;
    /**
     * `@2.5.0` Indicates if the video is an active live.
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
     * `@2.6.0` Stream / Download URL.
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
     * `@2.6.0` Song views count
     * @type {number}
     */
    views: number;
    /**
     * `@2.6.0` Song like count
     * @type {number}
     */
    likes: number;
    /**
     * `@2.6.0` Song dislike count
     * @type {number}
     */
    dislikes: number;
    /**
     * `@2.6.0` Song repost count
     * @type {number}
     */
    reposts: number;
    /**
     * `@3.0.0` Song uploader
     * @type {object}
     * @prop {?string} name Uploader name
     * @prop {?string} url Uploader url
     */
    uploader: object;
    /**
     * @param {Playlist} playlist Playlist
     * @ignore
     */
    _playlist(playlist: Playlist): void;
    /**
     * `@3.0.0` The playlist added this song
     * @type {?Playlist}
     */
    playlist: Playlist | null;
}
import Discord = require("discord.js");
import ytdl = require("ytdl-core");
import Playlist = require("./Playlist");
