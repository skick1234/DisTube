/* eslint no-unused-vars: "off" */
const { formatDuration } = require("./duration"),
  Discord = require("discord.js"),
  Song = require("./Song"),
  ytpl = require("@distube/ytpl");

const deprecate = (obj, oldProp, value, newProp = null) => {
  Object.defineProperty(obj, oldProp, {
    get: () => {
      if (newProp) console.warn(`\`playlist.${oldProp}\` will be removed in the next major release, use \`playlist.${newProp}\` instead.`);
      else console.warn(`\`playlist.${oldProp}\` will be removed completely in the next major release.`);
      return value;
    },
  });
};

const deprecateProps = {
  title: "name",
  items: "songs",
};

/** Class representing a playlist. */
class Playlist {
  /**
   * Create a playlist
   * @param {ytpl.result|Song[]} playlist Playlist
   * @param {Discord.User} user Requested user
   * @param {Object} properties Custom properties
   */
  constructor(playlist, user, properties = {}) {
    /**
     * User requested.
     * @type {Discord.User}
     */
    this.user = user || playlist.user;
    /**
     * Playlist songs.
     * @type {Song[]}
     */
    this.songs = Array.isArray(playlist) ? playlist : playlist.items;
    if (!Array.isArray(this.songs) || !this.songs.length) throw new Error("Playlist is empty!");
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

    // Old version compatible
    /**
     * @deprecated use `Playlist.name` instead
     * @type {string}
     */
    this.title = "";
    /**
     * @deprecated use `Playlist.songs` instead
     * @type {Song[]}
     */
    this.items = [];
    /**
     * @deprecated use `Playlist.songs.length` instead
     * @type {number}
     */
    this.total_items = this.songs.length || 0;
    /**
     * @deprecated
     * @type {string}
     */
    this.id = playlist.id || "";
    /**
     * @deprecated
     * @type {object}
    */
    this.author = playlist.author || {};
    for (let [oldProp, newProp] of Object.entries(deprecateProps)) deprecate(this, oldProp, this[newProp], newProp);
    for (let prop of ["id", "author", "total_items"]) deprecate(this, prop, this[prop]);
  }

  /**
   * Playlist duration in second.
   * @type {number}
   */
  get duration() {
    if (!this.songs[0]) return 0;
    return this.songs.reduce((prev, next) => prev + next.duration, 0)
  }

  /**
   * Formatted duration string `hh:mm:ss`.
   * @type {string}
   */
  get formattedDuration() {
    return formatDuration(this.duration * 1000)
  }
}

module.exports = Playlist;
