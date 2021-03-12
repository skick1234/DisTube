const { formatDuration } = require("./util"),
  Song = require("./Song");

/**
 * @typedef {import("discord.js").GuildMember} GuildMember
 * @typedef {import("discord.js").User} User
 */

/** Class representing a playlist. */
class Playlist {
  /**
   * Create a playlist
   * @param {Song[]} playlist Playlist
   * @param {GuildMember} member Requested user
   * @param {Object} properties Custom properties
   */
  constructor(playlist, member, properties = {}) {
    if (typeof properties !== "object") throw new TypeError("Custom properties must be an object");
    /**
     * User requested.
     * @type {GuildMember}
     */
    this.member = member || playlist.member;
    /**
     * User requested.
     * @type {User}
     */
    this.user = this.member?.user;
    /**
     * Playlist songs.
     * @type {Song[]}
     */
    this.songs = Array.isArray(playlist) ? playlist : playlist.items;
    if (!this.songs || !this.songs.length) throw new Error("Playlist is empty!");
    this.songs.map(s => s instanceof Song && s._patchPlaylist(this, this.member));
    /**
     * Playlist name.
     * @type {string}
     */
    this.name = playlist.name || playlist.title || this.songs[0].playlist_title || `${this.songs[0].name} and ${this.songs.length - 1} more songs.`;
    /**
     * Playlist URL.
     * @type {string}
     */
    this.url = playlist.url;
    /**
     * Playlist thumbnail.
     * @type {string}
     */
    this.thumbnail = playlist.thumbnail || this.songs[0].thumbnail;
    for (let [key, value] of Object.entries(properties)) this[key] = value;
  }

  /**
   * Playlist duration in second.
   * @type {number}
   */
  get duration() {
    if (!this.songs[0]) return 0;
    return this.songs.reduce((prev, next) => prev + next.duration, 0);
  }

  /**
   * Formatted duration string `hh:mm:ss`.
   * @type {string}
   */
  get formattedDuration() {
    return formatDuration(this.duration * 1000);
  }
}

module.exports = Playlist;
