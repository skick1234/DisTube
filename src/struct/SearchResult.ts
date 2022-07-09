import { DisTubeError, SearchResultType, formatDuration, toSecond } from "..";
import type { Playlist, Video } from "@distube/ytsr";

/** A abstract class representing a search result. */
abstract class ISearchResult {
  source: "youtube";
  abstract type: SearchResultType;
  id: string;
  name: string;
  url: string;
  uploader: {
    name?: string;
    url?: string;
  };

  /**
   * Create a search result
   * @param {Object} info ytsr result
   */
  constructor(info: Video | Playlist) {
    /**
     * The source of the search result
     * @type {"youtube"}
     */
    this.source = "youtube";
    /**
     * YouTube video or playlist id
     * @type {string}
     */
    this.id = info.id;
    /**
     * Video or playlist title.
     * @type {string}
     */
    this.name = info.name;
    /**
     * Video or playlist URL.
     * @type {string}
     */
    this.url = info.url;
    /**
     * Video or playlist uploader
     * @type {Object}
     * @prop {string?} name Uploader name
     * @prop {string?} url Uploader url
     */
    this.uploader = {
      name: undefined,
      url: undefined,
    };
  }
}

export class SearchResultVideo extends ISearchResult {
  type: SearchResultType.VIDEO;
  views: number;
  isLive: boolean;
  duration: number;
  formattedDuration: string;
  thumbnail: string;
  constructor(info: Video) {
    super(info);
    if (info.type !== "video") throw new DisTubeError("INVALID_TYPE", "video", info.type, "type");
    /**
     * Type of SearchResult
     * @type {SearchResultType.VIDEO}
     */
    this.type = SearchResultType.VIDEO;
    /**
     * Video views count
     * @type {number}
     */
    this.views = info.views;
    /**
     * Indicates if the video is an active live.
     * @type {boolean}
     */
    this.isLive = info.isLive;
    /**
     * Video duration.
     * @type {number}
     */
    this.duration = this.isLive ? 0 : toSecond(info.duration);
    /**
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
     * @type {string}
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    /**
     * Video thumbnail.
     * @type {string}
     */
    this.thumbnail = info.thumbnail;
    this.uploader = {
      name: info.author?.name,
      url: info.author?.url,
    };
  }
}

export class SearchResultPlaylist extends ISearchResult {
  type: SearchResultType.PLAYLIST;
  length: number;
  constructor(info: Playlist) {
    super(info);
    if (info.type !== "playlist") throw new DisTubeError("INVALID_TYPE", "playlist", info.type, "type");
    /**
     * Type of SearchResult
     * @type {SearchResultType.PLAYLIST}
     */
    this.type = SearchResultType.PLAYLIST;
    /**
     * Length of the playlist
     * @type {number}
     */
    this.length = info.length;
    this.uploader = {
      name: info.owner?.name,
      url: info.owner?.url,
    };
  }
}

export type SearchResult = SearchResultVideo | SearchResultPlaylist;
