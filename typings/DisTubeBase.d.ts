export = DisTubeBase;
/** @private */
declare class DisTubeBase {
    /** @param {DisTube} distube distube */
    constructor(distube: DisTube);
    /** @type {DisTube} */
    distube: DisTube;
    /** @type {DisTubeHandler} */
    handler: DisTubeHandler;
    /** @type {DisTube.DisTubeOptions} */
    options: DisTube.DisTubeOptions;
    /** @type {Discord.Client} */
    client: Discord.Client;
    emit(...args: any[]): void;
}
import DisTube = require("./DisTube");
import DisTubeHandler = require("./DisTubeHandler");
import Discord = require("discord.js");
