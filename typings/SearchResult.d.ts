export = SearchResult;
/** `@2.7.0` Class representing a search result. */
declare class SearchResult {
    /**
     * Create a search result.
     * @param {ytsr.Video|ytsr.Playlist} info Video info
     */
    constructor(info: any | any);
    /**
     * Type of SearchResult (video or playlist)
     * @type {string}
     */
    type: string;
    /**
     * Youtube video or playlist id
     * @type {string}
     */
    id: string;
    /**
     * Video or playlist  title.
     * @type {string}
     */
    name: string;
    /**
     * Video or playlist URL.
     * @type {string}
     */
    url: string;
    /**
     * Video duration.
     * @type {number}
     */
    duration: number;
    /**
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
     * @type {string}
     */
    formattedDuration: string;
    /**
     * Video thumbnail.
     * @type {string}
     */
    thumbnail: string;
    /**
     * Indicates if the video is an active live.
     * @type {boolean}
     */
    isLive: boolean;
    /**
     * Video views count
     * @type {number}
     */
    views: number;
}
