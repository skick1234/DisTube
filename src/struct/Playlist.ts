import { DisTubeError, formatDuration, isMemberInstance, isRecord } from "..";
import type { PlaylistInfo, Song } from "..";
import type { GuildMember } from "discord.js";

/**
 * Class representing a playlist.
 * @prop {string} source Playlist source
 * @template T - The type for the metadata (if any) of the playlist
 */
export class Playlist<T = unknown> implements PlaylistInfo {
  source!: string;
  songs!: Song[];
  name!: string;
  #metadata!: T;
  #member?: GuildMember;
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
    playlist: Song[] | PlaylistInfo,
    options: {
      member?: GuildMember;
      properties?: Record<string, any>;
      metadata?: T;
    } = {},
  ) {
    const { member, properties, metadata } = options;

    if (
      typeof playlist !== "object" ||
      (!Array.isArray(playlist) && ["source", "songs"].some(key => !(key in playlist)))
    ) {
      throw new DisTubeError("INVALID_TYPE", ["Array<Song>", "PlaylistInfo"], playlist, "playlist");
    }
    if (typeof properties !== "undefined" && !isRecord<any>(properties)) {
      throw new DisTubeError("INVALID_TYPE", "object", properties, "properties");
    }

    if (Array.isArray(playlist)) {
      /**
       * The source of the playlist
       * @type {string}
       */
      this.source = "youtube";
      if (!playlist.length) throw new DisTubeError("EMPTY_PLAYLIST");
      /**
       * Playlist songs.
       * @type {Array<Song>}
       */
      this.songs = playlist;
      /**
       * Playlist name.
       * @type {string}
       */
      this.name = this.songs[0].name
        ? `${this.songs[0].name} and ${this.songs.length - 1} more songs.`
        : `${this.songs.length} songs playlist`;
      this.thumbnail = this.songs[0].thumbnail;
      this.member = member;
    } else {
      this.source = playlist.source.toLowerCase();
      if (!Array.isArray(playlist.songs) || !playlist.songs.length) throw new DisTubeError("EMPTY_PLAYLIST");
      this.songs = playlist.songs;
      this.name =
        playlist.name ||
        // eslint-disable-next-line deprecation/deprecation
        playlist.title ||
        (this.songs[0].name
          ? `${this.songs[0].name} and ${this.songs.length - 1} more songs.`
          : `${this.songs.length} songs playlist`);
      /**
       * Playlist URL.
       * @type {string}
       */
      // eslint-disable-next-line deprecation/deprecation
      this.url = playlist.url || playlist.webpage_url;
      /**
       * Playlist thumbnail.
       * @type {string?}
       */
      this.thumbnail = playlist.thumbnail || this.songs[0].thumbnail;
      this.member = member || playlist.member;
    }
    this.songs.forEach(s => s.constructor.name === "Song" && (s.playlist = this));
    if (properties) for (const [key, value] of Object.entries(properties)) this[key] = value;
    /**
     * Optional metadata that can be used to identify the playlist.
     * @type {T}
     */
    this.metadata = metadata as T;
  }

  /**
   * Playlist duration in second.
   * @type {number}
   */
  get duration() {
    return this.songs.reduce((prev, next) => prev + next.duration, 0);
  }

  /**
   * Formatted duration string `hh:mm:ss`.
   * @type {string}
   */
  get formattedDuration() {
    return formatDuration(this.duration);
  }

  /**
   * User requested.
   * @type {Discord.GuildMember?}
   */
  get member() {
    return this.#member;
  }

  set member(member: GuildMember | undefined) {
    if (!isMemberInstance(member)) return;
    this.#member = member;
    this.songs.forEach(s => s.constructor.name === "Song" && (s.member = this.member));
  }

  /**
   * User requested.
   * @type {Discord.User?}
   */
  get user() {
    return this.member?.user;
  }

  get metadata() {
    return this.#metadata;
  }

  set metadata(metadata: T) {
    this.#metadata = metadata;
    this.songs.forEach(s => s.constructor.name === "Song" && (s.metadata = metadata));
  }
}
