export = SearchResult;
/** Class representing a search result. */
declare class SearchResult {
    /**
     * Create a search result
     * @param {Object} info ytsr result
     */
    constructor(info: any);
    source: string;
    /**
     * Type of SearchResult (video or playlist)
     * @type {string}
     */
    type: string;
    /**
     * YouTube video or playlist id
     * @type {string}
     */
    id: string;
    /**
     * Video or playlist title.
     * @type {string}
     */
    name: string;
    /**
     * Video or playlist URL.
     * @type {string}
     */
    url: string;
    /**
     * Video / Playlist views count
     * @type {number}
     */
    views: number;
    /**
     * Indicates if the video is an active live.
     * @type {boolean?}
     */
    isLive: boolean | null;
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
     * @type {string?}
     */
    thumbnail: string | null;
    /**
     * Video/Playlist uploader
     * @type {Object}
     * @prop {string?} name Uploader name
     * @prop {string?} url Uploader url
     */
    uploader: any;
}
