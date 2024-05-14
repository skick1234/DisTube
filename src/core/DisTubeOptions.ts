import { DisTubeError, StreamType, checkInvalidKey, defaultOptions } from "..";
import type { DisTubeOptions, ExtractorPlugin, FFmpegArgs, FFmpegOptions, Filters } from "..";

export class Options {
  plugins: ExtractorPlugin[];
  emitNewSongOnly: boolean;
  savePreviousSongs: boolean;
  customFilters?: Filters;
  nsfw: boolean;
  emitAddSongWhenCreatingQueue: boolean;
  emitAddListWhenCreatingQueue: boolean;
  joinNewVoiceChannel: boolean;
  streamType: StreamType;
  directLink: boolean;
  ffmpeg: FFmpegOptions;
  constructor(options: DisTubeOptions) {
    if (typeof options !== "object" || Array.isArray(options)) {
      throw new DisTubeError("INVALID_TYPE", "object", options, "DisTubeOptions");
    }
    const opts = { ...defaultOptions, ...options };
    this.plugins = opts.plugins;
    this.emitNewSongOnly = opts.emitNewSongOnly;
    this.savePreviousSongs = opts.savePreviousSongs;
    this.customFilters = opts.customFilters;
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
      "savePreviousSongs",
      "joinNewVoiceChannel",
      "nsfw",
      "emitAddSongWhenCreatingQueue",
      "emitAddListWhenCreatingQueue",
      "directLink",
    ]);
    const numberOptions = new Set();
    const stringOptions = new Set();
    const objectOptions = new Set(["customFilters", "ffmpeg"]);
    const optionalOptions = new Set(["customFilters"]);

    for (const [key, value] of Object.entries(options)) {
      if (value === undefined && optionalOptions.has(key)) continue;
      if (key === "streamType" && (typeof value !== "number" || isNaN(value) || !StreamType[value])) {
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
    const args: {
      global: FFmpegArgs;
      input: FFmpegArgs;
      output: FFmpegArgs;
    } = { global: {}, input: {}, output: {} };
    if (opts.ffmpeg?.args) {
      if (opts.ffmpeg.args.global) args.global = opts.ffmpeg.args.global;
      if (opts.ffmpeg.args.input) args.input = opts.ffmpeg.args.input;
      if (opts.ffmpeg.args.output) args.output = opts.ffmpeg.args.output;
    }
    return { path: opts.ffmpeg?.path ?? "ffmpeg", args };
  }
}
