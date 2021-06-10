const ytdl = require("ytdl-core");
const { FFmpeg, opus } = require("prism-media");
const { pipeline, Transform } = require("stream");

/**
 * @typedef {Object} StreamOptions
 * @prop {number} seek Time to seek in milliseconds
 * @prop {string[]} FFmpegArgs Additional FFmpeg arguments
 */

// From `ytdl-core-discord`
const nextBestFormat = (formats, isLive) => {
  let filter = format => format.audioBitrate;
  if (isLive) filter = format => format.audioBitrate && format.isHLS;
  formats = formats
    .filter(filter)
    .sort((a, b) => b.audioBitrate - a.audioBitrate);
  return formats.find(format => !format.bitrate) || formats[0];
};

const createStream = (url, options = {}) => {
  const args = [
    "-i", url,
    "-analyzeduration", "0",
    "-loglevel", "0",
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
  ];
  if (typeof options.seek === "number" && options.seek > 0) args.push("-ss", options.seek.toString());
  if (Array.isArray(options.FFmpegArgs)) args.push(...options.FFmpegArgs);
  const transcoder = new FFmpeg({ args, shell: false });
  const encoder = new opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });
  return pipeline([transcoder, encoder], () => undefined);
};

module.exports = class DisTubeStream {
  /**
   * Create a stream from ytdl info
   * @param {ytdl.videoInfo} info ytdl full info
   * @param {StreamOptions} options options
   * @returns {Transform}
   */
  static YouTube(info, options = {}) {
    if (!info.full) throw new TypeError("info must be a full videoInfo from ytdl.getInfo().");
    if (!options) throw new TypeError("options must be an object.");
    options.quality = "highestaudio";
    if (info.videoDetails.lengthSeconds !== 0) options.filter = "audioonly";
    else options.filter = "audioandvideo";
    const filter = format =>
      format.audioSampleRate === "48000" &&
      format.codecs === "opus" &&
      format.container === "webm";
    const format = info.formats.find(filter);
    if (format && info.videoDetails.lengthSeconds > 0 && options.seek <= 0 && !options.FFmpegArgs?.length) {
      return pipeline([
        ytdl.downloadFromInfo(info, { ...options, filter }),
        new opus.WebmDemuxer(),
      ], () => undefined);
    } else {
      const bestFormat = nextBestFormat(info.formats, info.videoDetails.isLive);
      if (!bestFormat) throw new Error("No suitable format found");
      return createStream(bestFormat.url, options);
    }
  }
  /**
   * Create a stream from a stream url
   * @param {string} url stream url
   * @param {StreamOptions} options options
   * @returns {Transform}
   */
  static DirectLink(url, options = {}) {
    if (!options) throw new Error("options must be an object.");
    return createStream(url, options);
  }
};
