export = Playlist;
import Discord from "discord.js";
import Song from "./Song";
/** Class representing a playlist. */
declare class Playlist {
    /**
     * Create a playlist
     * @param {object|Song[]} playlist Playlist
     * @param {Discord.User} user Requested user
     * @param {object} properties Custom properties
     */
    constructor(playlist: object | Song[], user: Discord.User, properties?: object);
    /**
     * User requested.
     * @type {Discord.User}
     */
    user: Discord.User;
    /**
     * PLaylist songs.
     * @type {Song[]}
     */
    songs: Song[];
    /**
     * Playlist name.
     * @type {string}
     */
    name: string;
    /**
     * PLaylist URL.
     * @type {string}
     */
    url: string;
    /**
     * PLaylist thumbnail.
     * @type {string}
     */
    thumbnail: string;
    /** @deprecated use `Playlist.name` instead */
    title: string;
    /** @deprecated use `Playlist.songs` instead */
    items: any[];
    /** @deprecated use `Playlist.songs.length` instead */
    total_items: number;
    /** @deprecated */
    id: any;
    /** @deprecated */
    author: any;
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
