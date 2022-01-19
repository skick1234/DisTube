import { DisTubeError, formatDuration, isMemberInstance } from "..";
import type ytpl from "@distube/ytpl";
import type { PlaylistInfo, Song } from "..";
import type { GuildMember, User } from "discord.js";

/**
 * Class representing a playlist.
 * @prop {string} source Playlist source
 * @template T - The type for the metadata (if any) of the playlist
 */
export class Playlist<T = unknown> implements PlaylistInfo {
  source!: string;
  songs!: Song[];
  name!: string;
  metadata!: T;
  member?: GuildMember;
  user?: User;
  url?: string;
  thumbnail?: string;
  [x: string]: any;
  /**
   * Create a playlist
   * @param {Song[]|PlaylistInfo} playlist Playlist
   * @param {Object} [options] Optional options
   * @param {Discord.GuildMember} [options.member] Requested user
   * @param {Object} [options.properties] Custom properties
   * @param {T} [options.metadata] Playlist metadata
   */
  constructor(
    playlist: Song[] | ytpl.result | PlaylistInfo,
    options: {
      member?: GuildMember;
      properties?: Record<string, any>;
      metadata?: T;
    } = {},
  ) {
    const { member, properties, metadata } = Object.assign({ properties: {} }, options);

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
     * Playlist songs.
     * @type {Array<Song>}
     */
    this.songs = Array.isArray(info) ? info : info.items || info.songs;
    if (!Array.isArray(this.songs) || !this.songs.length) {
      throw new DisTubeError("EMPTY_PLAYLIST");
    }
    this._patchMember(member || info.member);
    /**
     * Playlist name.
     * @type {string}
     */
    this.name =
      info.name ||
      info.title ||
      (this.songs[0].name
        ? `${this.songs[0].name} and ${this.songs.length - 1} more songs.`
        : `${this.songs.length} songs playlist`);
    /**
     * Playlist URL.
     * @type {string}
     */
    this.url = info.url || info.webpage_url;
    /**
     * Playlist thumbnail.
     * @type {?string}
     */
    this.thumbnail = info.thumbnail?.url || info.thumbnail || this.songs[0].thumbnail;
    for (const [key, value] of Object.entries(properties)) {
      this[key] = value;
    }
    /**
     * Optional metadata that can be used to identify the playlist.
     * @type {T}
     */
    this.metadata = metadata as T;
    this._patchMetadata(metadata);
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

  /**
   * @param {?Discord.GuildMember} [member] Requested user
   * @private
   * @returns {Playlist}
   */
  _patchMember(member?: GuildMember) {
    if (isMemberInstance(member)) {
      /**
       * User requested.
       * @type {?Discord.GuildMember}
       */
      this.member = member;
      /**
       * User requested.
       * @type {?Discord.User}
       */
      this.user = this.member?.user;
    }
    this.songs.map(s => s.constructor.name === "Song" && s._patchPlaylist(this, this.member));
    return this;
  }

  /**
   * @param {*} metadata Metadata
   * @private
   * @returns {Playlist}
   */
  _patchMetadata<S = unknown>(metadata: S) {
    this.metadata = metadata as unknown as T;
    this.songs.map(s => s.constructor.name === "Song" && s._patchMetadata(metadata));
    return this as unknown as Playlist<S>;
  }
}
