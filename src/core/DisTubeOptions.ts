import ytdl from "ytdl-core";
import { CustomPlugin, ExtractorPlugin } from "../DisTube";
import { Filters, DisTubeOptions } from "../types";
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
  constructor(options: DisTubeOptions) {
    const defaultOptions = {
      plugins: [],
      emitNewSongOnly: false,
      leaveOnEmpty: true,
      leaveOnFinish: false,
      leaveOnStop: true,
      savePreviousSongs: true,
      youtubeDL: true,
      updateYouTubeDL: true,
      searchSongs: 0,
      customFilters: {},
      ytdlOptions: {
        highWaterMark: 1 << 24,
      },
      searchCooldown: 60,
      emptyCooldown: 60,
      nsfw: false,
    };
    // Object.assign(this, defaultOptions, options);
    const opts = Object.assign({}, defaultOptions, options);
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
    this._validateOptions();
  }

  private _validateOptions(options = this) {
    if (typeof options.emitNewSongOnly !== "boolean") {
      throw new TypeError("DisTubeOptions.emitNewSongOnly must be a boolean");
    }
    if (typeof options.leaveOnEmpty !== "boolean") {
      throw new TypeError("DisTubeOptions.leaveOnEmpty must be a boolean");
    }
    if (typeof options.leaveOnFinish !== "boolean") {
      throw new TypeError("DisTubeOptions.leaveOnFinish must be a boolean");
    }
    if (typeof options.leaveOnStop !== "boolean") {
      throw new TypeError("DisTubeOptions.leaveOnStop must be a boolean");
    }
    if (typeof options.savePreviousSongs !== "boolean") {
      throw new TypeError("DisTubeOptions.savePreviousSongs must be a boolean");
    }
    if (typeof options.youtubeDL !== "boolean") {
      throw new TypeError("DisTubeOptions.youtubeDL must be a boolean");
    }
    if (typeof options.updateYouTubeDL !== "boolean") {
      throw new TypeError("DisTubeOptions.updateYouTubeDL must be a boolean");
    }
    if (typeof options.youtubeCookie !== "undefined" && typeof options.youtubeCookie !== "string") {
      throw new TypeError("DisTubeOptions.youtubeCookie must be a string");
    }
    if (typeof options.youtubeIdentityToken !== "undefined" && typeof options.youtubeIdentityToken !== "string") {
      throw new TypeError("DisTubeOptions.youtubeIdentityToken must be a string");
    }
    if (typeof options.customFilters !== "object" || Array.isArray(options.customFilters)) {
      throw new TypeError("DisTubeOptions.customFilters must be an object");
    }
    if (typeof options.ytdlOptions !== "object" || Array.isArray(options.ytdlOptions)) {
      throw new TypeError("DisTubeOptions.customFilters must be an object");
    }
    if (typeof options.searchCooldown !== "number" || isNaN(options.searchCooldown)) {
      throw new TypeError("DisTubeOptions.searchCooldown must be a number");
    }
    if (typeof options.emptyCooldown !== "number" || isNaN(options.emptyCooldown)) {
      throw new TypeError("DisTubeOptions.emptyCooldown must be a number");
    }
    if (typeof options.searchSongs !== "number" || isNaN(options.emptyCooldown)) {
      throw new TypeError("DisTubeOptions.searchSongs must be a number");
    }
    if (!Array.isArray(options.plugins)) {
      throw new TypeError("DisTubeOptions.plugins must be an array of Plugin.");
    }
    if (typeof options.nsfw !== "boolean") {
      throw new TypeError("DisTubeOptions.nsfw must be a boolean");
    }
  }
}

export default Options;
