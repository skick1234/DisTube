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
     * @param {Discord.VoiceChannel|Discord.StageChannel} voiceChannel The voice channel will be joined
     * @param {string} url Validated url
     * @param {Discord.GuildMember} member Requested user
     * @param {Discord.TextChannel?} textChannel Default {@link Queue#textChannel}
     * @param {boolean} skip Skip the playing song (if exists)
     */
    play(voiceChannel: Discord.VoiceChannel | Discord.StageChannel, url: string, member: Discord.GuildMember, textChannel: Discord.TextChannel | null, skip: boolean): Promise<void>;
}
import Plugin = require("./Plugin");
import Discord = require("discord.js");
