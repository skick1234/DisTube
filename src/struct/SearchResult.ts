import { DisTubeError, formatDuration, toSecond } from "..";
import type { Playlist, Video } from "@distube/ytsr";

/** Class representing a search result. */
export class SearchResult {
  source: "youtube";
  type: "video" | "playlist";
  id: string;
  name: string;
  url: string;
  views?: number;
  isLive?: boolean;
  duration?: number;
  formattedDuration?: string;
  thumbnail?: string;
  /** Video or playlist uploader */
  uploader: {
    /** Uploader name */
    name?: string;
    /** Uploader url */
    url?: string;
  };
  /**
   * Create a search result
   * @param {Object} info ytsr result
   */
  constructor(info: Video | Playlist) {
    this.source = "youtube";
    /**
     * Type of SearchResult (`video` or `playlist`)
     * @type {string}
     */
    this.type = info.type;
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
    if (this.type === "video") {
      info = info as Video;
      /**
       * [Video only] Video or playlist views count
       * @type {number}
       */
      this.views = info.views;
      /**
       * [Video only] Indicates if the video is an active live.
       * @type {boolean?}
       */
      this.isLive = info.isLive;
      /**
       * [Video only] Video duration.
       * @type {number}
       */
      this.duration = this.isLive ? 0 : toSecond(info.duration);
      /**
       * [Video only] Formatted duration string `hh:mm:ss` or `mm:ss`.
       * @type {string}
       */
      this.formattedDuration = this.isLive ? "Live" : formatDuration(this.duration);
      /**
       * [Video only] Video thumbnail.
       * @type {string?}
       */
      this.thumbnail = info.thumbnail;
    } else if (this.type !== "playlist") {
      throw new DisTubeError("INVALID_TYPE", ["video", "playlist"], this.type, "SearchResult.type");
    }
    /**
     * Song uploader
     * @type {Object}
     * @prop {string?} name Uploader name
     * @prop {string?} url Uploader url
     */
    this.uploader = {
      name: ((info as Video).author || (info as Playlist).owner)?.name,
      url: ((info as Video).author || (info as Playlist).owner)?.url,
    };
  }
}
