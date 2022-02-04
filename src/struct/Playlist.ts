import { DisTubeError, formatDuration, isMemberInstance } from "..";
import type ytpl from "@distube/ytpl";
import type { PlaylistInfo, Song } from "..";
import type { GuildMember } from "discord.js";

// TODO: Remove ! on the next major version

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
  constructor(playlist: Song[] | ytpl.result | PlaylistInfo);
  /** @deprecated Passing GuildMember for DisTube#Playlist() is deprecated. */
  constructor(
    playlist: Song[] | ytpl.result | PlaylistInfo,
    member?: GuildMember,
    properties?: Record<string, any>,
    metadata?: T,
  );
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
    options?: {
      member?: GuildMember;
      properties?: Record<string, any>;
      metadata?: T;
    },
  );
  constructor(
    playlist: Song[] | ytpl.result | PlaylistInfo,
    options:
      | GuildMember
      | {
          member?: GuildMember;
          properties?: Record<string, any>;
          metadata?: T;
        } = {},
    props?: Record<string, any>,
    meta?: T,
  ) {
    if (isMemberInstance(options)) {
      process.emitWarning(
        "Passing GuildMember for DisTube#Playlist() is deprecated, read the docs for more.",
        "DeprecationWarning",
      );
      return new Playlist(playlist, { member: options, properties: props, metadata: meta });
    }

    const { member, properties, metadata } = options;

    if (typeof playlist !== "object") {
      throw new DisTubeError("INVALID_TYPE", ["Array<Song>", "object"], playlist, "playlist");
    }
    if ("properties" in options && typeof properties !== "object") {
      throw new DisTubeError("INVALID_TYPE", "object", properties, "properties");
    }
    // FIXME
    const info = playlist as any;
    /**
     * The source of the playlist
     * @type {string}
     */
    this.source = (info.source || properties?.source || "youtube").toLowerCase();
    /**
     * Playlist songs.
     * @type {Array<Song>}
     */
    this.songs = Array.isArray(info) ? info : info.items || info.songs;
    if (!Array.isArray(this.songs) || !this.songs.length) {
      throw new DisTubeError("EMPTY_PLAYLIST");
    }
    this.songs.map(s => s.constructor.name === "Song" && (s.playlist = this));
    this.member = member || info.member || undefined;
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
     * @type {string?}
     */
    this.thumbnail = info.thumbnail?.url || info.thumbnail || this.songs[0].thumbnail;
    if (properties) for (const [key, value] of Object.entries(properties)) this[key] = value;

    this.metadata = metadata as T;
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
   * User requested.
   * @type {Discord.GuildMember?}
   */
  get member() {
    return this.#member;
  }

  set member(member: GuildMember | undefined) {
    if (!member) return;
    this.#member = member;
    this.songs.map(s => s.constructor.name === "Song" && (s.member = this.member));
  }

  /**
   * User requested.
   * @type {Discord.User?}
   */
  get user() {
    return this.member?.user;
  }

  /**
   * Optional metadata that can be used to identify the playlist.
   * @type {T}
   */
  get metadata() {
    return this.#metadata;
  }

  set metadata(metadata: T) {
    this.#metadata = metadata;
    this.songs.map(s => s.constructor.name === "Song" && (s.metadata = metadata));
  }
}
