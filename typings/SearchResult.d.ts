export = SearchResult;
/** Class representing a search result. */
declare class SearchResult {
    constructor(info: any);
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
     * Video duration.
     * @type {number|string|null}
     */
    duration: number | string | null;
    /**
     * Formatted duration string `hh:mm:ss` or `mm:ss`.
     * @type {string?}
     */
    formattedDuration: string | null;
    /**
     * Video thumbnail.
     * @type {string?}
     */
    thumbnail: string | null;
    /**
     * Indicates if the video is an active live.
     * @type {boolean?}
     */
    isLive: boolean | null;
    /**
     * Video / Playlist views count
     * @type {number}
     */
    views: number;
}
