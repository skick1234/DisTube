import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";

/** The ffmpeg executable this engine decodes and filters with. */
export function ffmpegCommand(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

/** Keep diagnostic output useful without retaining an unbounded decoder transcript. */
const MAX_STDERR_BYTES = 4096;

/** Facts reported when one ffmpeg decode reaches a terminal process state. */
export interface FfmpegOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly error?: Error;
}

/** A running decode of one track: raw 48 kHz stereo PCM on stdout and one terminal outcome. */
export type FfmpegStream = ChildProcessByStdio<null, Readable, Readable> & {
  readonly outcome: Promise<FfmpegOutcome>;
};

/**
 * Decodes `url` for the voice connection, starting at `seconds` and applying `chain`.
 *
 * Seeking before the input keeps the decode cheap, which is what makes a mid-track filter re-render
 * affordable; its accuracy is whatever the container's keyframes allow.
 */
export function spawnFfmpeg(url: string, seconds: number, chain?: string): FfmpegStream {
  const child = spawn(
    ffmpegCommand(),
    [
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-analyzeduration",
      "0",
      "-loglevel",
      "0",
      ...(seconds > 0 ? ["-ss", String(seconds)] : []),
      "-max_redirects",
      "0",
      "-i",
      url,
      "-vn",
      ...(chain ? ["-af", chain] : []),
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  ) as FfmpegStream;
  const captured = captureStderr(child.stderr);
  let settle!: (outcome: FfmpegOutcome) => void;
  let settled = false;
  const outcome = new Promise<FfmpegOutcome>(resolve => {
    settle = resolve;
  });
  const complete = (code: number | null, signal: NodeJS.Signals | null, error?: Error): void => {
    if (settled) return;
    settled = true;
    settle({ code, signal, stderr: captured(), ...(error ? { error } : {}) });
  };

  // A missing executable or a broken pipe must become one decode outcome, never an unhandled error.
  child.on("error", error => {
    child.stdout.destroy();
    complete(child.exitCode, child.signalCode, error);
  });
  child.stdout.on("error", () => undefined);
  child.stderr.on("error", () => undefined);
  child.once("close", (code, signal) => complete(code, signal));
  Object.defineProperty(child, "outcome", { value: outcome });
  return child;
}

/** Ends a decode and its process; an already-dead one is left alone. */
export function killFfmpeg(stream: FfmpegStream): void {
  stream.stdout.destroy();
  stream.stderr.destroy();
  if (stream.exitCode === null && stream.signalCode === null) stream.kill("SIGKILL");
}

/** A process can count as natural completion only after a conventional successful exit. */
export function finishedFfmpeg(outcome: FfmpegOutcome): boolean {
  return outcome.error === undefined && outcome.code === 0 && outcome.signal === null;
}

/** Builds a bounded public decoder failure without exposing a playable input or its credentials. */
export function ffmpegFailure(outcome: FfmpegOutcome): Error {
  const status = outcome.error
    ? `FFmpeg could not start: ${outcome.error.message}`
    : outcome.signal
      ? `FFmpeg exited from signal ${outcome.signal}`
      : `FFmpeg exited with code ${outcome.code ?? "unknown"}`;
  const message = boundedDiagnostic(outcome.stderr ? `${status}: ${outcome.stderr}` : status);
  return outcome.error ? new Error(message, { cause: outcome.error }) : new Error(message);
}

/** Captures just enough stderr to explain a failure, then redacts it when the process settles. */
function captureStderr(stderr: Readable): () => string {
  let tail = Buffer.alloc(0);
  stderr.on("data", (value: string | Buffer) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (chunk.length >= MAX_STDERR_BYTES) {
      tail = Buffer.from(chunk.subarray(chunk.length - MAX_STDERR_BYTES));
      return;
    }
    const combined = Buffer.concat([tail, chunk]);
    tail = Buffer.from(combined.subarray(Math.max(0, combined.length - MAX_STDERR_BYTES)));
  });
  return () => boundedDiagnostic(tail.toString("utf8"));
}

function boundedDiagnostic(value: string): string {
  return boundUtf8(redactDiagnostic(value), MAX_STDERR_BYTES);
}

function redactDiagnostic(value: string): string {
  return value
    .replace(/\b(?:https?|wss?|rtmp):\/\/[^\s<>"'`\\]+/giu, "<redacted-url>")
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-amz-(?:security-token|signature|credential)|x-goog-signature)\s*:\s*[^\r\n]*/giu,
      "<redacted>",
    )
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|signature|sig|key|password|secret|credential|x[-_](?:api[-_]?key|amz[-_](?:security[-_]?token|signature|credential)|goog[-_]?signature))\b\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1<redacted>",
    )
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer <redacted>");
}

/** Truncates by encoded byte length so multibyte diagnostic input never escapes the public limit. */
function boundUtf8(value: string, limit: number): string {
  if (Buffer.byteLength(value, "utf8") <= limit) return value;
  let size = 0;
  let bounded = "";
  for (const character of value) {
    const characterSize = Buffer.byteLength(character, "utf8");
    if (size + characterSize > limit) break;
    bounded += character;
    size += characterSize;
  }
  return bounded;
}
