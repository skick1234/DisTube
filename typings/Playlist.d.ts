/// <reference types="@distube/ytpl" />
export = Playlist;
/** Class representing a playlist. */
declare class Playlist {
    /**
     * Create a playlist
     * @param {ytpl.result|Song[]} playlist Playlist
     * @param {Discord.GuildMember} member Requested user
     * @param {Object} properties Custom properties
     */
    constructor(playlist: import("ytpl").result | Song[], member: Discord.GuildMember, properties?: any);
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
