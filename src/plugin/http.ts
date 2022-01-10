import http from "http";
import ExtractorPlugin from "../struct/ExtractorPlugin";
import { resolveHttpSong, validateAudioURL } from "..";
import type { GuildMember } from "discord.js";

export class HTTPPlugin extends ExtractorPlugin {
  async validate(url: string) {
    return validateAudioURL(http, "http:", url);
  }

  async resolve(url: string, options: { member?: GuildMember; metadata?: any } = {}) {
    return resolveHttpSong(url, { ...options, source: "http" });
  }
}

export default HTTPPlugin;
