import { defaultOptions } from "../constant";
import { DisTubeError } from "../struct/DisTubeError";
import type { DisTubeOptions, DisTubePlugin, FFmpegArgs, FFmpegOptions, Filters } from "../type";
import { checkInvalidKey } from "../util";

export class Options {
  plugins: DisTubePlugin[];
  emitNewSongOnly: boolean;
  savePreviousSongs: boolean;
  customFilters?: Filters;
  nsfw: boolean;
  emitAddSongWhenCreatingQueue: boolean;
  emitAddListWhenCreatingQueue: boolean;
  joinNewVoiceChannel: boolean;
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
    ]);
    const numberOptions = new Set();
    const stringOptions = new Set();
    const objectOptions = new Set(["customFilters", "ffmpeg"]);
    const optionalOptions = new Set(["customFilters"]);

    for (const [key, value] of Object.entries(options)) {
      if (value === undefined && optionalOptions.has(key)) continue;
      if (key === "plugins" && !Array.isArray(value)) {
        throw new DisTubeError("INVALID_TYPE", "Array<Plugin>", value, `DisTubeOptions.${key}`);
      } else if (booleanOptions.has(key)) {
        if (typeof value !== "boolean") {
          throw new DisTubeError("INVALID_TYPE", "boolean", value, `DisTubeOptions.${key}`);
        }
      } else if (numberOptions.has(key)) {
        if (typeof value !== "number" || Number.isNaN(value)) {
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
    const args: FFmpegArgs = { global: {}, input: {}, output: {} };
    if (opts.ffmpeg?.args) {
      if (opts.ffmpeg.args.global) args.global = opts.ffmpeg.args.global;
      if (opts.ffmpeg.args.input) args.input = opts.ffmpeg.args.input;
      if (opts.ffmpeg.args.output) args.output = opts.ffmpeg.args.output;
    }
    const path = opts.ffmpeg?.path ?? "ffmpeg";
    if (typeof path !== "string") {
      throw new DisTubeError("INVALID_TYPE", "string", path, "DisTubeOptions.ffmpeg.path");
    }
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new DisTubeError("INVALID_TYPE", "object", value, `DisTubeOptions.ffmpeg.${key}`);
      }
      for (const [k, v] of Object.entries(value)) {
        if (
          typeof v !== "string" &&
          typeof v !== "number" &&
          typeof v !== "boolean" &&
          !Array.isArray(v) &&
          v !== null &&
          v !== undefined
        ) {
          throw new DisTubeError(
            "INVALID_TYPE",
            ["string", "number", "boolean", "Array<string | null | undefined>", "null", "undefined"],
            v,
            `DisTubeOptions.ffmpeg.${key}.${k}`,
          );
        }
      }
    }
    return { path, args };
  }
}
