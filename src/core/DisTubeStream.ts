import ytdl from "ytdl-core";
import { FFmpeg } from "prism-media";
import { StreamType } from "@discordjs/voice";

interface StreamOptions extends ytdl.downloadOptions {
  /**
   * Time to seek in seconds
   */
  seek?: number;
  /**
   * Additional FFmpeg arguments
   */
  ffmpegArgs?: string[];
  /**
   * If the stream url is live
   */
  isLive?: boolean;
}

const chooseBestFormat = (formats: ytdl.videoFormat[], isLive = false) => {
  let filter = (format: ytdl.videoFormat) => format.audioBitrate ? format.audioBitrate > 0 : false;
  if (isLive) filter = (format: ytdl.videoFormat) => (format.audioBitrate ? format.audioBitrate > 0 : false) && format.isHLS;
  formats = formats.filter(filter).sort((a, b) => Number(b.audioBitrate) - Number(a.audioBitrate));
  return formats.find(format => !format.bitrate) || formats[0];
};

// Use ffmpeg libopus codec
// function libopusSupport(): boolean {
//   try {
//     return FFmpeg.getInfo().output.includes("--enable-libopus");
//   } catch { }
//   return false;
// }

// const supportOggOpus = libopusSupport();

/**
 * Create a stream to play with {@link DisTubeVoice}
 * @private
 */
export class DisTubeStream {
  /**
   * Create a stream from ytdl video formats
   * @param {ytdl.videoFormat[]} formats ytdl video formats
   * @param {StreamOptions} options options
   * @returns {*}
   */
  static YouTube(formats: ytdl.videoFormat[] | undefined, options: StreamOptions = {}): DisTubeStream {
    if (!formats || !formats.length) throw new TypeError("This video is unavailable");
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("options must be an object.");
    const bestFormat = chooseBestFormat(formats, options.isLive);
    if (!bestFormat) throw new Error("No suitable format found");
    return new DisTubeStream(bestFormat.url, options);
  }
  /**
   * Create a stream from a stream url
   * @param {string} url stream url
   * @param {StreamOptions} options options
   * @returns {Readable|string}
   */
  static DirectLink(url: string, options: StreamOptions = {}): DisTubeStream {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("options must be an object.");
    if (typeof url !== "string") throw new Error("url must be a string.");
    return new DisTubeStream(url, options);
  }
  type: StreamType.Raw | StreamType.OggOpus | StreamType.Arbitrary;
  stream: FFmpeg | string;
  /**
   * Create a DisTubeStream to play with {@link DisTubeVoice}
   * @param {string} url Stream URL
   * @param {StreamOptions} options Stream options
   */
  constructor(url: string, options: StreamOptions) {
    if ((!options.seek || options.seek < 0) && !options.ffmpegArgs?.length) {
      this.type = StreamType.Arbitrary;
      this.stream = url;
    } else {
      const args = [
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-i", url,
        "-analyzeduration", "0",
        "-loglevel", "0",
        "-ar", "48000",
        "-ac", "2",
      ];
      // Use ffmpeg libopus codec
      // if (supportOggOpus) {
      //   args.push("-acodec", "libopus", "-f", "opus");
      //   this.type = StreamType.OggOpus;
      // } else {
      args.push("-f", "s16le");
      this.type = StreamType.Raw;
      // }
      if (typeof options.seek === "number" && options.seek > 0) args.push("-ss", options.seek.toString());
      if (Array.isArray(options.ffmpegArgs)) args.push(...options.ffmpegArgs);
      this.stream = new FFmpeg({ args, shell: false });
    }
  }
}

export default DisTubeStream;
