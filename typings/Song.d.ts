export = Song;
/** Class representing a song. */
declare class Song {
    /**
     * Create a song.
     * @param {ytdl.videoInfo|Object} info Video info
     * @param {Discord.User} user Requested user
     * @param {boolean} [youtube=false] Weather or not the video is a Youtube video.
     */
    constructor(info: ytdl.videoInfo | any, user: Discord.User, youtube?: boolean);
    /**
     * `@2.6.0` Weather or not the video is a Youtube video.
     * @type {boolean}
     */
    youtube: boolean;
    info: any;
    /**
     * User requested
     * @type {Discord.User}
     */
    user: Discord.User;
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
     * @deprecated use `Song.views` instead
     * @type {number}
     */
    plays: number;
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
     * @deprecated use `Song.name` instead
     * @type {string}
     */
    title: string;
    /**
     * @deprecated use `Song.url` instead
     * @type {string}
     */
    link: string;
}
import Discord = require("discord.js");
import ytdl = require("ytdl-core");
