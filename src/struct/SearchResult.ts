import { DisTubeError, SearchResultType, formatDuration, toSecond } from "..";
import type { Playlist, Video } from "@distube/ytsr";

/**
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
   * Create a search result
   *
   * @param info - ytsr result
   */
  constructor(info: Video | Playlist) {
    /**
     * The source of the search result
     */
    this.source = "youtube";
    /**
     * YouTube video or playlist id
     */
    this.id = info.id;
    /**
     * Video or playlist title.
     */
    this.name = info.name;
    /**
     * Video or playlist URL.
     */
    this.url = info.url;
    /**
     * Video or playlist uploader
     */
    this.uploader = {
      name: undefined,
      url: undefined,
    };
  }
}

/**
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
     * Type of SearchResult
     */
    this.type = SearchResultType.VIDEO;
    /**
     * Video views count
     */
    this.views = info.views;
    /**
     * Indicates if the video is an active live.
     */
    this.isLive = info.isLive;
    /**
     * Video duration.
     */
    this.duration = this.isLive ? 0 : toSecond(info.duration);
    /**
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
     */
    this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
    /**
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
 * A video or playlist search result
 */
export type SearchResult = SearchResultVideo | SearchResultPlaylist;

/**
 * A class representing a playlist search result.
 */
export class SearchResultPlaylist extends ISearchResult {
  type: SearchResultType.PLAYLIST;
  length: number;
  constructor(info: Playlist) {
    super(info);
    if (info.type !== "playlist") throw new DisTubeError("INVALID_TYPE", "playlist", info.type, "type");
    /**
     * Type of SearchResult
     */
    this.type = SearchResultType.PLAYLIST;
    /**
     * Length of the playlist
     */
    this.length = info.length;
    this.uploader = {
      name: info.owner?.name,
      url: info.owner?.url,
    };
  }
}
