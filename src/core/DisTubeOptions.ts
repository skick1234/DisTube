import ytdl from "ytdl-core";
import { CustomPlugin, DisTubeError, DisTubeOptions, ExtractorPlugin, Filters, defaultOptions } from "..";

export class Options {
  /** DisTube plugins.*/
  plugins: (CustomPlugin | ExtractorPlugin)[];
  /** If `true`, {@link DisTube#event:playSong} will not be emitted when looping a song or next song is the same as the previous one */
  emitNewSongOnly: boolean;
  /** Whether or not leaving voice channel when the queue finishes. */
  leaveOnFinish: boolean;
  /** Whether or not leaving voice channel after using {@link DisTube#stop} function. */
  leaveOnStop: boolean;
  /** Whether or not leaving voice channel if the voice channel is empty after {@link DisTubeOptions}.emptyCooldown seconds. */
  leaveOnEmpty: boolean;
  /** Built-in leave on empty cooldown in seconds (When leaveOnEmpty is true) */
  emptyCooldown: number;
  /** Whether or not saving the previous songs of the queue and enable {@link DisTube#previous} method */
  savePreviousSongs: boolean;
  /** Limit of search results emits in {@link DisTube#event:searchResult} event when {@link DisTube#play} method executed. If `searchSongs <= 1`, play the first result */
  searchSongs: number;
  /** Built-in search cooldown in seconds (When `searchSongs` is bigger than 0) */
  searchCooldown: number;
  /** YouTube cookies. Read how to get it in {@link https://github.com/fent/node-ytdl-core/blob/997efdd5dd9063363f6ef668bb364e83970756e7/example/cookies.js#L6-L12|YTDL's Example} */
  youtubeCookie?: string;
  /** If not given; ytdl-core will try to find it. You can find this by going to a video's watch page; viewing the source; and searching for "ID_TOKEN". */
  youtubeIdentityToken?: string;
  /** Whether or not using youtube-dl. */
  youtubeDL: boolean;
  /** Whether or not updating youtube-dl automatically. */
  updateYouTubeDL: boolean;
  /** Override {@link DefaultFilters} or add more ffmpeg filters. Example=`{ "Filter name"="Filter value"; "8d"="apulsator=hz=0.075" }` */
  customFilters: Filters;
  /** `ytdl-core` options */
  ytdlOptions: ytdl.downloadOptions;
  /** Whether or not playing age-restricted content and disabling safe search when using {@link DisTube#play} in non-NSFW channel. */
  nsfw: boolean;
  /** Whether or not emitting `addList` event when creating a new Queue */
  emitAddSongWhenCreatingQueue: boolean;
  /** Whether or not emitting `addSong` event when creating a new Queue */
  emitAddListWhenCreatingQueue: boolean;
  constructor(options: DisTubeOptions) {
    const def = { ...defaultOptions };
    // Object.assign(this, defaultOptions, options);
    const opts = Object.assign({}, def, options);
    this.plugins = opts.plugins;
    this.emitNewSongOnly = opts.emitNewSongOnly;
    this.leaveOnEmpty = opts.leaveOnEmpty;
    this.leaveOnFinish = opts.leaveOnFinish;
    this.leaveOnStop = opts.leaveOnStop;
    this.savePreviousSongs = opts.savePreviousSongs;
    this.youtubeDL = opts.youtubeDL;
    this.updateYouTubeDL = opts.updateYouTubeDL;
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
    this._validateOptions();
  }

  private _validateOptions(options = this) {
    if (typeof options.emitNewSongOnly !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", options.emitNewSongOnly, "DisTubeOptions.emitNewSongOnly");
    }
    if (typeof options.leaveOnEmpty !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", options.leaveOnEmpty, "DisTubeOptions.leaveOnEmpty");
    }
    if (typeof options.leaveOnFinish !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", options.leaveOnFinish, "DisTubeOptions.leaveOnFinish");
    }
    if (typeof options.leaveOnStop !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", options.leaveOnStop, "DisTubeOptions.leaveOnStop");
    }
    if (typeof options.savePreviousSongs !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", options.savePreviousSongs, "DisTubeOptions.savePreviousSongs");
    }
    if (typeof options.youtubeDL !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", options.youtubeDL, "DisTubeOptions.youtubeDL");
    }
    if (typeof options.updateYouTubeDL !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", options.updateYouTubeDL, "DisTubeOptions.updateYouTubeDL");
    }
    if (typeof options.youtubeCookie !== "undefined" && typeof options.youtubeCookie !== "string") {
      throw new DisTubeError("INVALID_TYPE", "string", options.youtubeCookie, "DisTubeOptions.youtubeCookie");
    }
    if (typeof options.youtubeIdentityToken !== "undefined" && typeof options.youtubeIdentityToken !== "string") {
      throw new DisTubeError(
        "INVALID_TYPE",
        "string",
        options.youtubeIdentityToken,
        "DisTubeOptions.youtubeIdentityToken",
      );
    }
    if (typeof options.customFilters !== "object" || Array.isArray(options.customFilters)) {
      throw new DisTubeError("INVALID_TYPE", "object", options.customFilters, "DisTubeOptions.customFilters");
    }
    if (typeof options.ytdlOptions !== "object" || Array.isArray(options.ytdlOptions)) {
      throw new DisTubeError("INVALID_TYPE", "object", options.ytdlOptions, "DisTubeOptions.ytdlOptions");
    }
    if (typeof options.searchCooldown !== "number" || isNaN(options.searchCooldown)) {
      throw new DisTubeError("INVALID_TYPE", "number", options.searchCooldown, "DisTubeOptions.searchCooldown");
    }
    if (typeof options.emptyCooldown !== "number" || isNaN(options.emptyCooldown)) {
      throw new DisTubeError("INVALID_TYPE", "number", options.emptyCooldown, "DisTubeOptions.emptyCooldown");
    }
    if (typeof options.searchSongs !== "number" || isNaN(options.searchSongs)) {
      throw new DisTubeError("INVALID_TYPE", "number", options.searchSongs, "DisTubeOptions.searchSongs");
    }
    if (!Array.isArray(options.plugins)) {
      throw new DisTubeError("INVALID_TYPE", "Array<Plugin>", options.plugins, "DisTubeOptions.plugins");
    }
    if (typeof options.nsfw !== "boolean") {
      throw new DisTubeError("INVALID_TYPE", "boolean", options.nsfw, "DisTubeOptions.nsfw");
    }
    if (typeof options.emitAddSongWhenCreatingQueue !== "boolean") {
      throw new DisTubeError(
        "INVALID_TYPE",
        "boolean",
        options.emitAddSongWhenCreatingQueue,
        "DisTubeOptions.emitAddSongWhenCreatingQueue",
      );
    }
    if (typeof options.emitAddListWhenCreatingQueue !== "boolean") {
      throw new DisTubeError(
        "INVALID_TYPE",
        "boolean",
        options.emitAddListWhenCreatingQueue,
        "DisTubeOptions.emitAddListWhenCreatingQueue",
      );
    }
  }
}

export default Options;
