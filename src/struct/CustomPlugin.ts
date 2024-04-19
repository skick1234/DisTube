import { Plugin } from ".";
import { PluginType } from "..";
import type { VoiceBasedChannel } from "discord.js";
import type { Awaitable, PlayOptions } from "..";

/**
 * Custom Plugin
 *
 * @virtual
 */
export abstract class CustomPlugin extends Plugin {
  readonly type = PluginType.CUSTOM;
  abstract play(voiceChannel: VoiceBasedChannel, song: string, options: PlayOptions): Awaitable<void>;
}

/**
 * This method will be executed if the url is validated.
 *
 * @virtual
 *
 * @param voiceChannel - The voice channel will be joined
 * @param song         - Validated `song`
 * @param options      - Optional options
 */

/**
 * Check if the string is working with this plugin
 *
 * @param string - String need to validate
 */
