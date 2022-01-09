import Plugin from "./Plugin";
import { PluginType } from "..";
import type { GuildMember, StageChannel, TextChannel, VoiceChannel } from "discord.js";

// TODO: Clean parameters on the next major version.

/**
 * Custom Plugin
 * @extends Plugin
 * @abstract
 */
export abstract class CustomPlugin extends Plugin {
  type = PluginType.CUSTOM;
  abstract play(
    voiceChannel: VoiceChannel | StageChannel,
    url: string,
    member: GuildMember,
    textChannel: TextChannel | undefined,
    skip: boolean,
    unshift: boolean,
    metadata?: any,
  ): Promise<void>;
}

/**
 * This method will be executed if the url is validated.
 * @param {Discord.VoiceChannel|Discord.StageChannel} voiceChannel The voice channel will be joined
 * @param {string} url Validated url
 * @param {Discord.GuildMember} member Requested user
 * @param {Discord.TextChannel?} textChannel Default {@link Queue#textChannel}
 * @param {boolean} skip Skip the playing song (if exists) and play the added song/playlist instantly
 * @param {boolean} unshift Add the song/playlist to the beginning of the queue (after the playing song if exists)
 * @returns {Promise<void>}
 * @method play
 * @memberof CustomPlugin#
 * @abstract
 */

export default CustomPlugin;
