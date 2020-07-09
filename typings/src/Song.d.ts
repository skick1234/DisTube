/// <reference types="discord.js" />
/// <reference types="ytdl-core" />
export = Song;
/** Class representing a song. */
declare class Song {
    /**
     * Create a song.
     * @param {ytdl.videoInfo} video Youtube video info
     * @param {Discord.User} user Requested user
     */
    constructor(video: import("ytdl-core").videoInfo, user: import("discord.js").User);
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
