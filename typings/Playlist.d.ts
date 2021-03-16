export = Playlist;
/** Class representing a playlist. */
declare class Playlist {
    constructor(playlist: any, member: any, properties?: {});
    /**
     * User requested.
     * @type {Discord.GuildMember}
     */
    member: Discord.GuildMember;
    /**
     * User requested.
     * @type {Discord.User}
     */
    user: Discord.User;
    /**
     * Playlist songs.
     * @type {Song[]}
     */
    songs: Song[];
    /**
     * Playlist name.
     * @type {string}
     */
    name: string;
    /**
     * Playlist URL.
     * @type {string}
     */
    url: string;
    /**
     * Playlist thumbnail.
     * @type {string}
     */
    thumbnail: string;
    /**
     * Playlist duration in second.
     * @type {number}
     */
    get duration(): number;
    /**
     * Formatted duration string `hh:mm:ss`.
     * @type {string}
     */
    get formattedDuration(): string;
}
import Discord = require("discord.js");
import Song = require("./Song");
