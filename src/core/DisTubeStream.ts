import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import type { TransformCallback } from "node:stream";
import { Transform } from "node:stream";
import type { AudioResource } from "@discordjs/voice";
import { createAudioResource, StreamType } from "@discordjs/voice";
import { TypedEmitter } from "tiny-typed-emitter";
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from "../constant";
import type { DisTube } from "../DisTube";
import { DisTubeError } from "../struct/DisTubeError";
import type { Awaitable, FFmpegArg, FFmpegOptions } from "../type";
import { Events } from "../type";

/**
 * Options for {@link DisTubeStream}
 */
export interface StreamOptions {
  /**
   * FFmpeg options
   */
  ffmpeg: FFmpegOptions;
  /**
   * Seek time (in seconds).
   * @default 0
   */
  seek?: number;
}

let checked = process.env.NODE_ENV === "test";
export const checkFFmpeg = (distube: DisTube) => {
  if (checked) return;
  const path = distube.options.ffmpeg.path;
  const debug = (str: string) => distube.emit(Events.FFMPEG_DEBUG, str);
  try {
    debug(`[test] spawn ffmpeg at '${path}' path`);
    const process = spawnSync(path, ["-h"], {
      windowsHide: true,
      encoding: "utf-8",
    });
    if (process.error) throw process.error;
    if (process.stderr && !process.stdout) throw new Error(process.stderr);

    const result = process.output.join("\n");
    const version = /ffmpeg version (\S+)/iu.exec(result)?.[1];
    if (!version) throw new Error("Invalid FFmpeg version");
    debug(`[test] ffmpeg version: ${version}`);
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? (e.stack ?? e.message) : String(e);
    debug(`[test] failed to spawn ffmpeg at '${path}': ${errorMessage}`);
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
  #ffmpegPath: string;
  #opts: string[];
  process?: ChildProcess;
  stream: VolumeTransformer;
  audioResource: AudioResource;
  /**
   * Create a DisTubeStream to play with {@link DisTubeVoice}
   * @param url     - Stream URL
   * @param options - Stream options
   */
  constructor(url: string, options: StreamOptions) {
    super();
    const { ffmpeg, seek } = options;
    const opts: FFmpegArg = {
      reconnect: 1,
      reconnect_streamed: 1,
      reconnect_delay_max: 5,
      analyzeduration: 0,
      hide_banner: true,
      ...ffmpeg.args.global,
      ...ffmpeg.args.input,
      i: url,
      ar: AUDIO_SAMPLE_RATE,
      ac: AUDIO_CHANNELS,
      ...ffmpeg.args.output,
      f: "s16le",
    };

    if (typeof seek === "number" && seek > 0) opts.ss = seek.toString();

    const fileUrl = new URL(url);
    if (fileUrl.protocol === "file:") {
      opts.reconnect = null;
      opts.reconnect_streamed = null;
      opts.reconnect_delay_max = null;
      opts.i = fileUrl.hostname + fileUrl.pathname;
    }

    this.#ffmpegPath = ffmpeg.path;
    this.#opts = [
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
    ];

    this.stream = new VolumeTransformer();
    this.stream
      .on("close", () => this.kill())
      .on("error", err => {
        this.debug(`[stream] error: ${err.message}`);
        this.emit("error", err);
      })
      .on("finish", () => this.debug("[stream] log: stream finished"));

    this.audioResource = createAudioResource(this.stream, {
      inputType: StreamType.Raw,
      inlineVolume: false,
    });
  }

  spawn() {
    this.debug(`[process] spawn: ${this.#ffmpegPath} ${this.#opts.join(" ")}`);
    this.process = spawn(this.#ffmpegPath, this.#opts, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    })
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

  setVolume(volume: number) {
    this.stream.vol = volume;
  }

  kill() {
    if (!this.stream.destroyed) this.stream.destroy();
    if (this.process && !this.process.killed) this.process.kill("SIGKILL");
  }
}

// Based on prism-media
class VolumeTransformer extends Transform {
  private buffer = Buffer.allocUnsafe(0);
  private readonly extrema = [-(2 ** (16 - 1)), 2 ** (16 - 1) - 1];
  vol = 1;

  override _transform(newChunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    const { vol } = this;
    if (vol === 1) {
      this.push(newChunk);
      done();
      return;
    }

    const bytes = 2;
    const chunk = Buffer.concat([this.buffer, newChunk]);
    const readableLength = Math.floor(chunk.length / bytes) * bytes;

    for (let i = 0; i < readableLength; i += bytes) {
      const value = chunk.readInt16LE(i);
      const clampedValue = Math.min(this.extrema[1], Math.max(this.extrema[0], value * vol));
      chunk.writeInt16LE(clampedValue, i);
    }

    this.buffer = chunk.subarray(readableLength);
    this.push(chunk.subarray(0, readableLength));
    done();
  }
}
