import { FFmpeg } from "prism-media";
import { DisTubeError, isURL } from "..";
import { StreamType as DiscordVoiceStreamType } from "@discordjs/voice";
import type { Song, StreamType } from "..";

interface StreamOptions {
  seek?: number;
  ffmpegArgs?: string[];
  type?: StreamType;
}

export const chooseBestVideoFormat = ({ duration, formats, isLive }: Song) =>
  formats &&
  formats
    .filter(f => f.hasAudio && (duration < 10 * 60 || f.hasVideo) && (!isLive || f.isHLS))
    .sort((a, b) => Number(b.audioBitrate) - Number(a.audioBitrate) || Number(a.bitrate) - Number(b.bitrate))[0];

/**
 * Create a stream to play with {@link DisTubeVoice}
 * @private
 */
export class DisTubeStream {
  /**
   * Create a stream from ytdl video formats
   * @param {Song} song A YouTube Song
   * @param {StreamOptions} options options
   * @returns {DisTubeStream}
   * @private
   */
  static YouTube(song: Song, options: StreamOptions = {}): DisTubeStream {
    if (song.source !== "youtube") throw new DisTubeError("INVALID_TYPE", "youtube", song.source, "Song#source");
    if (!song.formats?.length) throw new DisTubeError("UNAVAILABLE_VIDEO");
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new DisTubeError("INVALID_TYPE", "object", options, "options");
    }
    const bestFormat = chooseBestVideoFormat(song);
    if (!bestFormat) throw new DisTubeError("UNPLAYABLE_FORMATS");
    return new DisTubeStream(bestFormat.url, options);
  }
  /**
   * Create a stream from a stream url
   * @param {string} url stream url
   * @param {StreamOptions} options options
   * @returns {DisTubeStream}
   * @private
   */
  static DirectLink(url: string, options: StreamOptions = {}): DisTubeStream {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new DisTubeError("INVALID_TYPE", "object", options, "options");
    }
    if (typeof url !== "string" || !isURL(url)) {
      throw new DisTubeError("INVALID_TYPE", "an URL", url);
    }
    return new DisTubeStream(url, options);
  }
  type: DiscordVoiceStreamType;
  stream: FFmpeg;
  url: string;
  /**
   * Create a DisTubeStream to play with {@link DisTubeVoice}
   * @param {string} url Stream URL
   * @param {StreamOptions} options Stream options
   * @private
   */
  constructor(url: string, options: StreamOptions) {
    /**
     * Stream URL
     * @type {string}
     */
    this.url = url;
    /**
     * Stream type
     * @type {DiscordVoice.StreamType}
     */
    this.type = !options.type ? DiscordVoiceStreamType.OggOpus : DiscordVoiceStreamType.Raw;
    const args = [
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-i",
      url,
      "-analyzeduration",
      "0",
      "-loglevel",
      "0",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
    ];

    if (!options.type) args.push("opus", "-acodec", "libopus");
    else args.push("s16le");
    if (typeof options.seek === "number" && options.seek > 0) args.unshift("-ss", options.seek.toString());
    if (Array.isArray(options.ffmpegArgs) && options.ffmpegArgs.length) args.push(...options.ffmpegArgs);

    /**
     * FFmpeg stream
     * @type {FFmpeg}
     */
    this.stream = new FFmpeg({ args, shell: false });
    (<any>this.stream)._readableState && ((<any>this.stream)._readableState.highWaterMark = 1 << 25);
  }
}
