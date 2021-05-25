export = Plugin;
/**
 * DisTube Plugin
 * @private
 */
declare class Plugin {
    constructor(type: any);
    /**
     * Type of plugin (`"custom"` | `"extractor"`)
     * @type {string}
     */
    type: string;
    init(distube: any): void;
    /**
     * DisTube
     * @type {DisTube}
     */
    distube: DisTube;
    /**
     * Handler
     * @type {DisTubeHandler}
     */
    handler: any;
    /**
     * Check if the url is working with this plugin
     * @param {string} url Input url
     * @returns {Promise<boolean>}
     */
    validate(url: string): Promise<boolean>;
    /**
     * Get the stream url from {@link Song#url}. Returns {@link Song#url} by default. Not needed if the plugin plays song from YouTube.
     * @param {string} url Input url
     * @returns {Promise<string>}
     */
    getStreamURL(url: string): Promise<string>;
    /**
     * (Optional) Get related songs from a supported url (Not needed to add {@link Song#related} and member is `null` because it will be added with this function later)
     * @param {string} url Input url
     * @returns {Promise<Song[]>}
     */
    getRelatedSongs(url: string): Promise<Song[]>;
}
import DisTube = require("../DisTube");
import Song = require("../Song");
