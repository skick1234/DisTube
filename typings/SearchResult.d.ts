export = SearchResult;
/** `@2.7.0` Class representing a search result. */
declare class SearchResult {
    /**
     * Create a search result.
     * @param {ytsr.Video} info Video info
     */
    constructor(info: any);
    /**
     * Youtube video id
     * @type {string}
     */
    id: string;
    /**
     * Song name aka video title.
     * @type {string}
     */
    name: string;
    /**
     * Song duration.
     * @type {number}
     */
    duration: number;
    /**
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
     * @type {string}
     */
    formattedDuration: string;
    /**
     * Song URL.
     * @type {string}
     */
    url: string;
    /**
     * Song thumbnail.
     * @type {string}
     */
    thumbnail: string;
    /**
     * Indicates if the video is an active live.
     * @type {boolean}
     */
    isLive: boolean;
    /**
     * Song views count
     * @type {number}
     */
    views: number;
    /**
     * @deprecated use `Song.name` instead
     * @type {string}
     */
    title: string;
    /**
     * @deprecated use `Song.url` instead
     * @type {string}
     */
    link: string;
}
