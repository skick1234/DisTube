/// <reference types="discord.js" />
export = DisTubeBase;
declare class DisTubeBase {
    /** @param {DisTube} distube distube */
    constructor(distube: DisTube);
    distube: DisTube;
    handler: import("./DisTubeHandler");
    options: DisTube.DisTubeOptions;
    client: import("discord.js").Client;
    emit(...args: any[]): void;
}
import DisTube = require("./DisTube");
