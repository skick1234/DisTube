import { DisTubeError, formatDuration, isMemberInstance } from "..";
import type { PlaylistInfo, Song } from "..";
import type { GuildMember } from "discord.js";

/**
 * Class representing a playlist.
 */
export class Playlist<T = unknown> implements PlaylistInfo {
  /**
   * Playlist source.
   */
  source: string;
  /**
   * Songs in the playlist.
   */
  songs: Song[];
  /**
   * Playlist ID.
   */
  id?: string;
  /**
   * Playlist name.
   */
  name?: string;
  /**
   * Playlist URL.
   */
  url?: string;
  /**
   * Playlist thumbnail.
   */
  thumbnail?: string;
  #metadata!: T;
  #member?: GuildMember;
  /**
   * Create a Playlist
   * @param playlist  - Raw playlist info
   * @param options   - Optional data
   */
  constructor(playlist: PlaylistInfo, { member, metadata }: { member?: GuildMember; metadata?: T } = {}) {
    if (!Array.isArray(playlist.songs) || !playlist.songs.length) throw new DisTubeError("EMPTY_PLAYLIST");

    this.source = playlist.source.toLowerCase();
    this.songs = playlist.songs;
    this.name = playlist.name;
    this.id = playlist.id;
    this.url = playlist.url;
    this.thumbnail = playlist.thumbnail;
    this.member = member;
    this.songs.forEach(s => (s.playlist = this));
    this.metadata = metadata as T;
  }

  /**
   * Playlist duration in second.
   */
  get duration() {
    return this.songs.reduce((prev, next) => prev + next.duration, 0);
  }

  /**
   * Formatted duration string `hh:mm:ss`.
   */
  get formattedDuration() {
    return formatDuration(this.duration);
  }

  /**
   * User requested.
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
   */
  get user() {
    return this.member?.user;
  }

  /**
   * Optional metadata that can be used to identify the playlist.
   */
  get metadata() {
    return this.#metadata;
  }

  set metadata(metadata: T) {
    this.#metadata = metadata;
    this.songs.forEach(s => s.constructor.name === "Song" && (s.metadata = metadata));
  }
}
