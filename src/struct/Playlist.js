const { formatDuration } = require("./Util"),
  Song = require("./Song"),
  Discord = require("discord.js");

/** Class representing a playlist. */
class Playlist {
  /**
   * Create a playlist
   * @param {Array<Song>|Object} playlist Playlist
   * @param {Discord.GuildMember} member Requested user
   * @param {Object} properties Custom properties
   */
  constructor(playlist, member, properties = {}) {
    if (typeof properties !== "object") throw new TypeError("Custom properties must be an object");
    /**
     * The source of the playlist
     * @type {string}
     */
    this.source = (playlist.source || properties.source || "youtube").toLowerCase();
    /**
     * User requested.
     * @type {Discord.GuildMember}
     */
    this.member = member || playlist.member;
    /**
     * User requested.
     * @type {Discord.User}
     */
    this.user = this.member?.user;
    /**
     * Playlist songs.
     * @type {Array<Song>}
     */
    this.songs = Array.isArray(playlist) ? playlist : playlist.items || playlist.songs;
    if (!Array.isArray(this.songs) || !this.songs.length) throw new Error("Playlist is empty!");
    this.songs.map(s => s.constructor.name === "Song" && s._patchPlaylist(this, this.member));
    /**
     * Playlist name.
     * @type {string}
     */
    this.name = playlist.name || playlist.title || `${this.songs[0].name} and ${this.songs.length - 1} more songs.`;
    /**
     * Playlist URL.
     * @type {string}
     */
    this.url = playlist.url || playlist.webpage_url;
    /**
     * Playlist thumbnail.
     * @type {string}
     */
    this.thumbnail = playlist.thumbnail?.url || playlist.thumbnail || this.songs[0].thumbnail;
    for (const [key, value] of Object.entries(properties)) this[key] = value;
  }

  /**
   * Playlist duration in second.
   * @type {number}
   */
  get duration() {
    return this.songs?.reduce((prev, next) => prev + (next.duration || 0), 0) || 0;
  }

  /**
   * Formatted duration string `hh:mm:ss`.
   * @type {string}
   */
  get formattedDuration() {
    return formatDuration(this.duration);
  }
}

module.exports = Playlist;
