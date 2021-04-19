export = Plugin;
/** DisTube Plugin */
declare class Plugin {
    constructor(type: any);
    /**
     * Type of plugin (`"custom"` | `"extractor"`)
     * @type {string}
     */
    type: string;
    init(distube: any): void;
    distube: any;
    /**
     * Check if the url is working with this plugin
     * @param {string} url Input url
     * @returns {Promise<boolean>}
     */
    validate(url: string): Promise<boolean>;
}
