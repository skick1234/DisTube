export = CustomPlugin;
/**
 * Custom Plugin
 * @extends Plugin
*/
declare class CustomPlugin extends Plugin {
    /** Create a custom plugin */
    constructor();
    /**
     * Execute if the url is validated
     * @param {Discord.Message} message Message
     * @param {string} url URL
     * @param {boolean} skip Skip?
     * @returns {Promise<void>}
     */
    play(message: Discord.Message, url: string, skip: boolean): Promise<void>;
}
import Plugin = require("./Plugin");
import Discord = require("discord.js");
