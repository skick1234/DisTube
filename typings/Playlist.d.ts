export = Playlist;
/** Class representing a playlist. */
declare class Playlist {
    /**
     * Create a playlist
     * @param {ytpl.result|Song[]} playlist Playlist
     * @param {Discord.User} user Requested user
     * @param {Object} properties Custom properties
     */
    constructor(playlist: any | Song[], user: Discord.User, properties?: any);
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
     * @deprecated use `Playlist.name` instead
     * @type {string}
     */
    title: string;
    /**
     * @deprecated use `Playlist.songs` instead
     * @type {Song[]}
     */
    items: Song[];
    /**
     * @deprecated use `Playlist.songs.length` instead
     * @type {number}
     */
    total_items: number;
    /**
     * @deprecated
     * @type {string}
     */
    id: string;
    /**
     * @deprecated
     * @type {object}
    */
    author: object;
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
