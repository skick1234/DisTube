import { Playlist } from ".";
import { DisTubeError, formatDuration, isMemberInstance } from "..";
import type { GuildMember } from "discord.js";
import type { DisTubePlugin, SongInfo } from "..";

/**
 * Class representing a song.
 */
export class Song<T = unknown> {
  /**
   * The source of this song info
   */
  source: string;
  /**
   * Song ID.
   */
  id?: string;
  /**
   * Song name.
   */
  name?: string;
  /**
   * Indicates if the song is an active live.
   */
  isLive?: boolean;
  /**
   * Song duration.
   */
  duration: number;
  /**
   * Formatted duration string (`hh:mm:ss`, `mm:ss` or `Live`).
   */
  formattedDuration: string;
  /**
   * Song URL.
   */
  url?: string;
  /**
   * Song thumbnail.
   */
  thumbnail?: string;
  /**
   * Song view count
   */
  views?: number;
  /**
   * Song like count
   */
  likes?: number;
  /**
   * Song dislike count
   */
  dislikes?: number;
  /**
   * Song repost (share) count
   */
  reposts?: number;
  /**
   * Song uploader
   */
  uploader: {
    name?: string;
    url?: string;
  };
  /**
   * Whether or not an age-restricted content
   */
  ageRestricted?: boolean;
  /**
   * Stream info
   */
  stream:
    | {
        playFromSource: true;
        url?: string;
      }
    | {
        playFromSource: false;
        song?: Song;
      };
  /**
   * The plugin that created this song
   */
  plugin: DisTubePlugin | null;
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
    this.source = info.source.toLowerCase();
    this.metadata = <T>metadata;
    this.member = member;
    this.id = info.id;
    this.name = info.name;
    this.isLive = info.isLive;
    this.duration = this.isLive || !info.duration ? 0 : info.duration;
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    this.url = info.url;
    this.thumbnail = info.thumbnail;
    this.views = info.views;
    this.likes = info.likes;
    this.dislikes = info.dislikes;
    this.reposts = info.reposts;
    this.uploader = {
      name: info.uploader?.name,
      url: info.uploader?.url,
    };
    this.ageRestricted = info.ageRestricted;
    this.stream = { playFromSource: info.playFromSource };
    this.plugin = info.plugin;
  }

  /**
   * The playlist this song belongs to
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

  /**
   * Optional metadata that can be used to identify the song. This is attached by the
   * {@link DisTube#play} method.
   */
  get metadata() {
    return this.#metadata;
  }

  set metadata(metadata: T) {
    this.#metadata = metadata;
  }
}
