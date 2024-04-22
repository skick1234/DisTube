import { PassThrough } from "node:stream";
import { spawn, spawnSync } from "child_process";
import { TypedEmitter } from "tiny-typed-emitter";
import { DisTubeError, Events, StreamType, isURL } from "..";
import { StreamType as DiscordVoiceStreamType } from "@discordjs/voice";
import type { ChildProcess } from "child_process";
import type { Awaitable, DisTube, FFmpegArgs, FFmpegOptions, Song } from "..";

interface StreamOptions {
  ffmpeg: FFmpegOptions;
  seek?: number;
  type?: StreamType;
}

export const chooseBestVideoFormat = ({ duration, formats, isLive }: Song) =>
  formats &&
  formats
    .filter(f => f.hasAudio && (duration < 10 * 60 || f.hasVideo) && (!isLive || f.isHLS))
    .sort((a, b) => Number(b.audioBitrate) - Number(a.audioBitrate) || Number(a.bitrate) - Number(b.bitrate))[0];

let checked = process.env.NODE_ENV === "test";
export const checkFFmpeg = (distube: DisTube) => {
  if (checked) return;
  const path = distube.options.ffmpeg.path;
  const debug = (str: string) => distube.emit(Events.FFMPEG_DEBUG, str);
  try {
    debug(`[test] spawn ffmpeg at '${path}' path`);
    const process = spawnSync(path, ["-h"], { windowsHide: true, shell: true, encoding: "utf-8" });
    if (process.error) throw process.error;
    if (process.stderr && !process.stdout) throw new Error(process.stderr);

    const result = process.output.join("\n");
    const version = /ffmpeg version (\S+)/iu.exec(result)?.[1];
    if (!version) throw new Error("Invalid FFmpeg version");
    debug(`[test] ffmpeg version: ${version}`);

    if (result.includes("--enable-libopus")) {
      debug("[test] ffmpeg supports libopus");
    } else {
      debug("[test] ffmpeg does not support libopus");
      distube.options.streamType = StreamType.RAW;
    }
  } catch (e: any) {
    debug(`[test] failed to spawn ffmpeg at '${path}': ${e?.stack ?? e}`);
    throw new DisTubeError("FFMPEG_NOT_INSTALLED", path);
  }
  checked = true;
};

/**
 * Create a stream to play with {@link DisTubeVoice}
 */
export class DisTubeStream extends TypedEmitter<{
  debug: (debug: string) => Awaitable;
  error: (error: Error) => Awaitable;
}> {
  private killed = false;
  process: ChildProcess;
  stream: PassThrough;
  type: DiscordVoiceStreamType;
  url: string;
  /**
   * Create a DisTubeStream to play with {@link DisTubeVoice}
   *
   * @param url     - Stream URL
   * @param options - Stream options
   */
  constructor(url: string, { ffmpeg, seek, type }: StreamOptions) {
    super();
    this.url = url;
    this.type = !type ? DiscordVoiceStreamType.OggOpus : DiscordVoiceStreamType.Raw;
    const opts: FFmpegArgs = {
      reconnect: 1,
      reconnect_streamed: 1,
      reconnect_delay_max: 5,
      analyzeduration: 0,
      hide_banner: true,
      ...ffmpeg.args.global,
      ...ffmpeg.args.input,
      i: url,
      ar: 48000,
      ac: 2,
      ...ffmpeg.args.output,
    };

    if (!type) {
      opts.f = "opus";
      opts.acodec = "libopus";
    } else {
      opts.f = "s16le";
    }
    if (typeof seek === "number" && seek > 0) opts.ss = seek.toString();

    this.process = spawn(
      ffmpeg.path,
      [
        ...Object.entries(opts)
          .flatMap(([key, value]) =>
            Array.isArray(value)
              ? value.filter(Boolean).map(v => [`-${key}`, String(v)])
              : value == null || value === false
                ? []
                : [value === true ? `-${key}` : [`-${key}`, String(value)]],
          )
          .flat(),
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true },
    )
      .on("error", err => {
        this.debug(`[process] error: ${err.message}`);
        this.emit("error", err);
      })
      .on("exit", (code, signal) => {
        this.debug(`[process] exit: code=${code ?? "unknown"} signal=${signal ?? "unknown"}`);
        if (!code || [0, 255].includes(code)) return;
        this.debug(`[process] error: ffmpeg exited with code ${code}`);
        this.emit("error", new DisTubeError("FFMPEG_EXITED", code));
      });

    if (!this.process.stdout || !this.process.stderr) {
      this.kill();
      throw new Error("Failed to create ffmpeg process");
    }

    this.stream = new PassThrough();
    this.stream
      .on("close", () => this.kill())
      .on("error", err => {
        this.debug(`[stream] error: ${err.message}`);
        this.emit("error", err);
      })
      .on("finish", () => this.debug("[stream] log: stream finished"));
    this.process.stdout.pipe(this.stream);

    this.process.stderr.setEncoding("utf8")?.on("data", (data: string) => {
      const lines = data.split(/\r\n|\r|\n/u);
      for (const line of lines) {
        if (/^\s*$/.test(line)) continue;
        this.debug(`[ffmpeg] log: ${line}`);
      }
    });
  }

  private debug(debug: string) {
    this.emit("debug", debug);
  }

  kill() {
    if (this.killed) return;
    this.process.kill("SIGKILL");
    this.killed = true;
  }
  /**
   * Create a stream from a YouTube {@link Song}
   *
   * @param song    - A YouTube Song
   * @param options - options
   */
  static YouTube(song: Song, options: StreamOptions): DisTubeStream {
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
   *
   * @param url     - stream url
   * @param options - options
   */
  static DirectLink(url: string, options: StreamOptions): DisTubeStream {
    if (typeof url !== "string" || !isURL(url)) {
      throw new DisTubeError("INVALID_TYPE", "an URL", url);
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new DisTubeError("INVALID_TYPE", "object", options, "options");
    }
    return new DisTubeStream(url, options);
  }
}
