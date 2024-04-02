import { DisTubeError, SearchResultType, formatDuration, toSecond } from "..";
import type { Playlist, Video } from "@distube/ytsr";

/**
 * @remarks
 * A abstract class representing a search result.
 *
 * @virtual
 */
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
   * @remarks
   * Create a search result
   *
   * @param info - ytsr result
   */
  constructor(info: Video | Playlist) {
    /**
     * @remarks
     * The source of the search result
     */
    this.source = "youtube";
    /**
     * @remarks
     * YouTube video or playlist id
     */
    this.id = info.id;
    /**
     * @remarks
     * Video or playlist title.
     */
    this.name = info.name;
    /**
     * @remarks
     * Video or playlist URL.
     */
    this.url = info.url;
    /**
     * @remarks
     * Video or playlist uploader
     */
    this.uploader = {
      name: undefined,
      url: undefined,
    };
  }
}

/**
 * @remarks
 * A class representing a video search result.
 */
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
     * @remarks
     * Type of SearchResult
     */
    this.type = SearchResultType.VIDEO;
    /**
     * @remarks
     * Video views count
     */
    this.views = info.views;
    /**
     * @remarks
     * Indicates if the video is an active live.
     */
    this.isLive = info.isLive;
    /**
     * @remarks
     * Video duration.
     */
    this.duration = this.isLive ? 0 : toSecond(info.duration);
    /**
     * @remarks
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    /**
     * @remarks
     * Video thumbnail.
     */
    this.thumbnail = info.thumbnail;
    this.uploader = {
      name: info.author?.name,
      url: info.author?.url,
    };
  }
}

/**
 * @remarks
 * A video or playlist search result
 */
export type SearchResult = SearchResultVideo | SearchResultPlaylist;

/**
 * @remarks
 * A class representing a playlist search result.
 */
export class SearchResultPlaylist extends ISearchResult {
  type: SearchResultType.PLAYLIST;
  length: number;
  constructor(info: Playlist) {
    super(info);
    if (info.type !== "playlist") throw new DisTubeError("INVALID_TYPE", "playlist", info.type, "type");
    /**
     * @remarks
     * Type of SearchResult
     */
    this.type = SearchResultType.PLAYLIST;
    /**
     * @remarks
     * Length of the playlist
     */
    this.length = info.length;
    this.uploader = {
      name: info.owner?.name,
      url: info.owner?.url,
    };
  }
}
