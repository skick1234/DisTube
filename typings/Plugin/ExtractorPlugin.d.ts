export = ExtractorPlugin;
/**
 * Extractor Plugin
 * @extends Plugin
 */
declare class ExtractorPlugin extends Plugin {
    /** Create a extractor plugin */
    constructor();
    /**
     * Execute if the url is validated
     * @param {string} url URL
     * @param {Discord.GuildMember} member Requested user
     * @returns {Promise<void>}
     */
    resolve(url: string, member: Discord.GuildMember): Promise<void>;
}
import Plugin = require("./Plugin");
import Discord = require("discord.js");
