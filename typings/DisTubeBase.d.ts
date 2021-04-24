export = DisTubeBase;
/** @private */
declare class DisTubeBase {
    /** @param {DisTube} distube distube */
    constructor(distube: DisTube);
    /**
     * DisTube
     * @type {DisTube}
     * @private
     */
    private distube;
    /**
     * DisTube options
     * @type {DisTube.DisTubeOptions}
     * @private
     */
    private options;
    /**
     * Discord.js client
     * @type {Discord.Client}
     * @private
     */
    private client;
    /**
     * Redirect emitter
     * @private
     * @param  {...any} args arguments
     */
    private emit;
}
import DisTube = require("./DisTube");
