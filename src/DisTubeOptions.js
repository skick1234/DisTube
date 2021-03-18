const { mergeObject } = require("./util");
const defaultOptions = {
  emitNewSongOnly: false,
  leaveOnEmpty: true,
  leaveOnFinish: false,
  leaveOnStop: true,
  savePreviousSongs: true,
  youtubeDL: true,
  updateYouTubeDL: true,
  searchSongs: 0,
  youtubeCookie: null,
  youtubeIdentityToken: null,
  customFilters: {},
  ytdlOptions: {
    highWaterMark: 1 << 24,
  },
  searchCooldown: 60,
  emptyCooldown: 60,
};

module.exports = class DisTubeOptions {
  constructor(options) {
    const opt = mergeObject(defaultOptions, options);
    for (const key in opt) {
      this[key] = opt[key];
    }
    this._validateOptions();
  }

  _validateOptions(options = this) {
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
    if (options.youtubeCookie !== null && typeof options.youtubeCookie !== "string") {
      throw new TypeError("DisTubeOptions.youtubeCookie must be a string");
    }
    if (options.youtubeIdentityToken !== null && typeof options.youtubeIdentityToken !== "string") {
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
  }
};
