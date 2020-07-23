export = Song;
import ytdl from "ytdl-core";
import Discord from "discord.js";
/** Class representing a song. */
declare class Song {
    /**
     * Create a song.
     * @param {(ytdl.videoInfo|DisTube.ytpl_item)} video Youtube video info
     * @param {Discord.User} user Requested user
     */
    constructor(video: (ytdl.videoInfo | import("./DisTube").ytpl_item), user: Discord.User);
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
    related: ytdl.relatedVideo[];
}
