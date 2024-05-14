import { Playlist } from "./Playlist";
import { DisTubeError, formatDuration, isMemberInstance } from "..";
import type { SongInfo } from "..";
import type { GuildMember } from "discord.js";

/**
 * Class representing a song.
 */
export class Song<T = unknown> {
  source: string;
  id?: string;
  name?: string;
  isLive?: boolean;
  duration: number;
  formattedDuration: string;
  url?: string;
  thumbnail?: string;
  views?: number;
  likes?: number;
  dislikes?: number;
  reposts?: number;
  uploader: {
    name?: string;
    url?: string;
  };
  ageRestricted?: boolean;
  #metadata!: T;
  #member?: GuildMember;
  #playlist?: Playlist;
  /**
   * Create a Song
   *
   * @param info      - Raw song info
   * @param options   - Optional data
   */
  constructor(info: SongInfo, { member, metadata }: { member?: GuildMember; metadata?: T } = {}) {
    /**
     * The source of this song info
     */
    this.source = info.source.toLowerCase();
    /**
     * Optional metadata that can be used to identify the song. This is attached by the
     * {@link DisTube#play} method.
     */
    this.metadata = <T>metadata;
    this.member = member;

    /**
     * Song ID.
     */
    this.id = info.id;
    /**
     * Song name.
     */
    this.name = info.name;
    /**
     * Indicates if the song is an active live.
     */
    this.isLive = info.isLive;
    /**
     * Song duration.
     */
    this.duration = this.isLive || !info.duration ? 0 : info.duration;
    /**
     * Formatted duration string (`hh:mm:ss`, `mm:ss` or `Live`).
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    /**
     * Song URL.
     */
    this.url = info.url;
    /**
     * Song thumbnail.
     */
    this.thumbnail = info.thumbnail;
    /**
     * Song views count
     */
    this.views = info.views;
    /**
     * Song like count
     */
    this.likes = info.likes;
    /**
     * Song dislike count
     */
    this.dislikes = info.dislikes;
    /**
     * Song repost (share) count
     */
    this.reposts = info.reposts;
    /**
     * Song uploader
     */
    this.uploader = {
      name: info.uploader?.name,
      url: info.uploader?.url,
    };
    /**
     * Whether or not an age-restricted content
     */
    this.ageRestricted = info.ageRestricted;
  }

  /**
   * The playlist added this song
   */
  get playlist() {
    return this.#playlist;
  }

  set playlist(playlist: Playlist | undefined) {
    if (!(playlist instanceof Playlist)) throw new DisTubeError("INVALID_TYPE", "Playlist", playlist, "Song#playlist");
    this.#playlist = playlist;
    this.member = playlist.member;
  }

  /**
   * User requested to play this song.
   */
  get member() {
    return this.#member;
  }

  set member(member: GuildMember | undefined) {
    if (isMemberInstance(member)) this.#member = member;
  }

  /**
   * User requested to play this song.
   */
  get user() {
    return this.member?.user;
  }

  get metadata() {
    return this.#metadata;
  }

  set metadata(metadata: T) {
    this.#metadata = metadata;
  }
}
