import { DisTubeError, formatDuration } from "..";
import type Song from "./Song";
import type ytpl from "@distube/ytpl";
import type { PlaylistInfo } from "..";
import type { GuildMember, User } from "discord.js";

/**
 * Class representing a playlist.
 * @prop {string} source Playlist source
 */
export class Playlist implements PlaylistInfo {
  source: string;
  member?: GuildMember;
  user?: User;
  songs: Song[];
  name: string;
  url?: string;
  thumbnail?: string;
  [x: string]: any;
  /**
   * Create a playlist
   * @param {Song[]|PlaylistInfo} playlist Playlist
   * @param {Discord.GuildMember} member Requested user
   * @param {Object} properties Custom properties
   */
  constructor(playlist: Song[] | ytpl.result | PlaylistInfo, member?: GuildMember, properties: any = {}) {
    if (typeof playlist !== "object") {
      throw new DisTubeError("INVALID_TYPE", ["Array<Song>", "object"], playlist, "playlist");
    }
    if (typeof properties !== "object") {
      throw new DisTubeError("INVALID_TYPE", "object", properties, "properties");
    }
    // FIXME
    const info = playlist as any;
    /**
     * The source of the playlist
     * @type {string}
     */
    this.source = (info.source || properties.source || "youtube").toLowerCase();
    /**
     * User requested.
     * @type {Discord.GuildMember}
     */
    this.member = member || info.member;
    /**
     * User requested.
     * @type {Discord.User}
     */
    this.user = this.member?.user;
    /**
     * Playlist songs.
     * @type {Array<Song>}
     */
    this.songs = Array.isArray(info) ? info : info.items || info.songs;
    if (!Array.isArray(this.songs) || !this.songs.length) {
      throw new DisTubeError("EMPTY_PLAYLIST");
    }
    this.songs.map(s => s.constructor.name === "Song" && s._patchPlaylist(this, this.member));
    /**
     * Playlist name.
     * @type {string}
     */
    this.name = info.name || info.title || `${this.songs[0].name} and ${this.songs.length - 1} more songs.`;
    /**
     * Playlist URL.
     * @type {string}
     */
    this.url = info.url || info.webpage_url;
    /**
     * Playlist thumbnail.
     * @type {string}
     */
    this.thumbnail = info.thumbnail?.url || info.thumbnail || this.songs[0].thumbnail;
    for (const [key, value] of Object.entries(properties)) {
      this[key] = value;
    }
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

export default Playlist;
