import { DisTubeError, StreamType, checkInvalidKey, defaultOptions } from "..";
import type ytdl from "@distube/ytdl-core";
import type { Cookie } from "@distube/ytdl-core";
import type { CustomPlugin, DisTubeOptions, ExtractorPlugin, FFmpegArgs, FFmpegOptions, Filters } from "..";

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
  youtubeCookie?: Cookie[] | string;
  customFilters?: Filters;
  ytdlOptions: ytdl.getInfoOptions;
  nsfw: boolean;
  emitAddSongWhenCreatingQueue: boolean;
  emitAddListWhenCreatingQueue: boolean;
  joinNewVoiceChannel: boolean;
  streamType: StreamType;
  directLink: boolean;
  /** @deprecated */
  ffmpegPath: undefined = undefined;
  /** @deprecated */
  ffmpegDefaultArgs: undefined = undefined;
  ffmpeg: FFmpegOptions;
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
    this.ffmpeg = this.#ffmpegOption(options);
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
    const stringOptions = new Set();
    const objectOptions = new Set(["customFilters", "ytdlOptions", "ffmpeg"]);
    const optionalOptions = new Set(["youtubeCookie", "customFilters"]);

    for (const [key, value] of Object.entries(options)) {
      if (value === undefined && optionalOptions.has(key)) continue;
      if (key === "youtubeCookie" && !Array.isArray(value) && typeof value !== "string") {
        throw new DisTubeError("INVALID_TYPE", ["Array<Cookie>", "string"], value, `DisTubeOptions.${key}`);
      } else if (key === "streamType" && (typeof value !== "number" || isNaN(value) || !StreamType[value])) {
        throw new DisTubeError("INVALID_TYPE", "StreamType", value, `DisTubeOptions.${key}`);
      } else if (key === "plugins" && !Array.isArray(value)) {
        throw new DisTubeError("INVALID_TYPE", "Array<Plugin>", value, `DisTubeOptions.${key}`);
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

  #ffmpegOption(opts: DisTubeOptions) {
    let path: string;
    const args: {
      global: FFmpegArgs;
      input: FFmpegArgs;
      output: FFmpegArgs;
    } = { global: {}, input: {}, output: {} };
    /* eslint-disable deprecation/deprecation,no-console */
    if (opts.ffmpegPath) {
      console.warn("`DisTubeOptions.ffmpegPath` is deprecated. Use `ffmpeg.path` instead.");
      path = opts.ffmpegPath;
    }
    if (opts.ffmpegDefaultArgs) {
      console.warn("`DisTubeOptions.ffmpegDefaultArgs` is deprecated. Use `ffmpeg.args` instead.");
      args.global = opts.ffmpegDefaultArgs;
    }
    /* eslint-enable deprecation/deprecation,no-console */
    path ??= opts.ffmpeg?.path ?? `ffmpeg${process.platform === "win32" ? ".exe" : ""}`;
    if (opts.ffmpeg?.args) {
      if (opts.ffmpeg.args.global) args.global = opts.ffmpeg.args.global;
      if (opts.ffmpeg.args.input) args.input = opts.ffmpeg.args.input;
      if (opts.ffmpeg.args.output) args.output = opts.ffmpeg.args.output;
    }
    return { path, args };
  }
}
