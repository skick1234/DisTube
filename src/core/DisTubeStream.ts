import ytdl from "ytdl-core";
import { FFmpeg, opus } from "prism-media";
import { pipeline, Readable } from "stream";

interface StreamOptions extends ytdl.downloadOptions {
  /**
   * Time to seek in seconds
   */
  seek?: number
  /**
   * Additional FFmpeg arguments
   */
  FFmpegArgs?: string[]
}

// From `ytdl-core-discord`
const nextBestFormat = (formats: ytdl.videoFormat[], isLive: boolean) => {
  let filter = (format: ytdl.videoFormat) => format.audioBitrate ? format.audioBitrate > 0 : false;
  if (isLive) filter = (format: ytdl.videoFormat) => (format.audioBitrate ? format.audioBitrate > 0 : false) && format.isHLS;
  formats = formats.filter(filter).sort((a, b) => Number(b.audioBitrate) - Number(a.audioBitrate));
  return formats.find(format => !format.bitrate) || formats[0];
};

const createStream = (url: string, options: StreamOptions = {}) => {
  const args = [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
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
  return pipeline([transcoder, encoder], () => undefined) as unknown as Readable;
};

export class DisTubeStream {
  /**
   * Create a stream from ytdl info
   * @param {ytdl.videoInfo} info ytdl full info
   * @param {StreamOptions} options options
   * @returns {Readable}
   */
  static YouTube(info: ytdl.videoInfo, options: StreamOptions = {}): Readable {
    if (!(info as any).full) throw new TypeError("info must be a full videoInfo from ytdl.getInfo().");
    if (!options) throw new TypeError("options must be an object.");
    options.quality = "highestaudio";
    if (Number(info.videoDetails.lengthSeconds) > 0) options.filter = "audioonly";
    else options.filter = "audioandvideo";
    const filter = (format: ytdl.videoFormat) =>
      format.audioSampleRate === "48000" &&
      format.codecs === "opus" &&
      format.container === "webm";
    const format = info.formats.find(filter);
    if (format && Number(info.videoDetails.lengthSeconds) > 0 && !options?.seek && !options.FFmpegArgs?.length) {
      return pipeline([
        ytdl.downloadFromInfo(info, { ...options, filter }),
        new opus.WebmDemuxer(),
      ], () => undefined) as unknown as Readable;
    } else {
      const bestFormat = nextBestFormat(info.formats, (info.videoDetails as any).isLive);
      if (!bestFormat) throw new Error("No suitable format found");
      return createStream(bestFormat.url, options);
    }
  }
  /**
   * Create a stream from a stream url
   * @param {string} url stream url
   * @param {StreamOptions} options options
   * @returns {Readable}
   */
  static DirectLink(url: string, options: StreamOptions = {}): Readable {
    if (!options) throw new Error("options must be an object.");
    return createStream(url, options);
  }
}

export default DisTubeStream;
