import { DisTubeError, StreamType, checkInvalidKey, defaultOptions } from "..";
import type ytdl from "@distube/ytdl-core";
import type { CustomPlugin, DisTubeOptions, ExtractorPlugin, Filters } from "..";

export class Options {
  plugins: (CustomPlugin | ExtractorPlugin)[];
  emitNewSongOnly: boolean;
  leaveOnFinish: boolean;
  leaveOnStop: boolean;
  leaveOnEmpty: boolean;
  emptyCooldown: number;
  savePreviousSongs: boolean;
  searchSongs: number;
  searchCooldown: number;
  youtubeCookie?: string;
  youtubeIdentityToken?: string;
  customFilters?: Filters;
  ytdlOptions: ytdl.getInfoOptions;
  nsfw: boolean;
  emitAddSongWhenCreatingQueue: boolean;
  emitAddListWhenCreatingQueue: boolean;
  joinNewVoiceChannel: boolean;
  streamType: StreamType;
  directLink: boolean;
  constructor(options: DisTubeOptions) {
    if (typeof options !== "object" || Array.isArray(options)) {
      throw new DisTubeError("INVALID_TYPE", "object", options, "DisTubeOptions");
    }
    const opts = { ...defaultOptions, ...options };
    this.plugins = opts.plugins;
    this.emitNewSongOnly = opts.emitNewSongOnly;
    this.leaveOnEmpty = opts.leaveOnEmpty;
    this.leaveOnFinish = opts.leaveOnFinish;
    this.leaveOnStop = opts.leaveOnStop;
    this.savePreviousSongs = opts.savePreviousSongs;
    this.searchSongs = opts.searchSongs;
    this.youtubeCookie = opts.youtubeCookie;
    this.youtubeIdentityToken = opts.youtubeIdentityToken;
    this.customFilters = opts.customFilters;
    this.ytdlOptions = opts.ytdlOptions;
    this.searchCooldown = opts.searchCooldown;
    this.emptyCooldown = opts.emptyCooldown;
    this.nsfw = opts.nsfw;
    this.emitAddSongWhenCreatingQueue = opts.emitAddSongWhenCreatingQueue;
    this.emitAddListWhenCreatingQueue = opts.emitAddListWhenCreatingQueue;
    this.joinNewVoiceChannel = opts.joinNewVoiceChannel;
    this.streamType = opts.streamType;
    this.directLink = opts.directLink;
    checkInvalidKey(opts, this, "DisTubeOptions");
    this.#validateOptions();
  }

  #validateOptions(options = this) {
    const booleanOptions = new Set([
      "emitNewSongOnly",
      "leaveOnEmpty",
      "leaveOnFinish",
      "leaveOnStop",
      "savePreviousSongs",
      "joinNewVoiceChannel",
      "nsfw",
      "emitAddSongWhenCreatingQueue",
      "emitAddListWhenCreatingQueue",
      "directLink",
    ]);
    const numberOptions = new Set(["searchCooldown", "emptyCooldown", "searchSongs"]);
    const stringOptions = new Set(["youtubeCookie", "youtubeIdentityToken"]);
    const objectOptions = new Set(["customFilters", "ytdlOptions"]);
    const optionalOptions = new Set(["youtubeCookie", "youtubeIdentityToken", "customFilters"]);

    for (const [key, value] of Object.entries(options)) {
      if (value === undefined && optionalOptions.has(key)) continue;
      if (key === "streamType" && (typeof value !== "number" || isNaN(value) || !StreamType[value])) {
        throw new DisTubeError("INVALID_TYPE", "StreamType", value, `DisTubeOptions.${key}`);
      } else if (key === "plugins" && !Array.isArray(value)) {
        throw new DisTubeError("INVALID_TYPE", "Array<Plugin>", value, "DisTubeOptions.plugins");
      } else if (booleanOptions.has(key)) {
        if (typeof value !== "boolean") {
          throw new DisTubeError("INVALID_TYPE", "boolean", value, `DisTubeOptions.${key}`);
        }
      } else if (numberOptions.has(key)) {
        if (typeof value !== "number" || isNaN(value)) {
          throw new DisTubeError("INVALID_TYPE", "number", value, `DisTubeOptions.${key}`);
        }
      } else if (stringOptions.has(key)) {
        if (typeof value !== "string") {
          throw new DisTubeError("INVALID_TYPE", "string", value, `DisTubeOptions.${key}`);
        }
      } else if (objectOptions.has(key)) {
        if (typeof value !== "object" || Array.isArray(value)) {
          throw new DisTubeError("INVALID_TYPE", "object", value, `DisTubeOptions.${key}`);
        }
      }
    }
  }
}
