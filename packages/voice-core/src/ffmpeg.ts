import { type ChildProcessByStdio, spawn } from "node:child_process";
import { type ClientRequest, request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable, Writable } from "node:stream";
import { DisTubeError } from "distube";
import { type LocalPlaybackResource, localPlaybackResource } from "./validation";

/** The ffmpeg executable this engine decodes and filters with. */
export function ffmpegCommand(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

const MAX_STDERR_BYTES = 4096;
const MAX_ERROR_DEPTH = 4;
const MAX_ERROR_NODES = 12;
export const URL_READY_TIMEOUT_MS = 10_000;
const MANIFEST_CONTENT_TYPES = new Set([
  "application/dash+xml",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);
const retireDecoder = Symbol("retireDecoder");

export interface FfmpegOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly error?: Error;
}

/** A running decode of one track: raw 48 kHz stereo PCM on stdout and one terminal outcome. */
export type FfmpegStream = ChildProcessByStdio<Writable, Readable, Readable> & {
  readonly outcome: Promise<FfmpegOutcome>;
};

/** Opens one validated local input and starts a bounded, cancellable decoder run. */
export async function spawnFfmpeg(
  resource: LocalPlaybackResource,
  seconds: number,
  chain?: string,
  signal?: AbortSignal,
): Promise<FfmpegStream> {
  resource = localPlaybackResource(resource);
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new TypeError("FFmpeg offset must be a finite non-negative number");
  if (resource.kind === "stream" && seconds > 0) {
    throw new DisTubeError("UNSUPPORTED", "A one-shot stream cannot be restarted at an offset");
  }
  if (resource.kind === "url" && seconds > 0 && resource.seekable !== true) {
    throw new DisTubeError("UNSUPPORTED", "This URL resource is not seekable");
  }
  if (signal?.aborted) throw abortError();

  const privateValues =
    resource.kind === "url"
      ? [resource.url, ...Object.values(resource.headers ?? {})]
      : resource.kind === "file"
        ? [resource.path]
        : [];
  const redact = (value: string): string => {
    for (const secret of privateValues) if (secret) value = value.split(secret).join("<redacted>");
    return boundedDiagnostic(value);
  };
  const opened = resource.kind === "url" ? await openUrl(resource.url, resource.headers, signal, redact) : undefined;
  if (signal?.aborted) {
    opened?.cancel();
    throw abortError();
  }
  const input = resource.kind === "url" ? opened?.response : resource.kind === "stream" ? resource.stream : undefined;
  const inputArgs =
    resource.kind === "file"
      ? [...(seconds > 0 ? ["-ss", String(seconds)] : []), "-i", resource.path]
      : ["-protocol_whitelist", "pipe,fd", "-i", "pipe:0", ...(seconds > 0 ? ["-ss", String(seconds)] : [])];
  let child: FfmpegStream;
  try {
    child = spawn(
      ffmpegCommand(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        ...inputArgs,
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
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    ) as FfmpegStream;
  } catch (error) {
    opened?.cancel();
    input?.destroy();
    throw safeInputError("FFmpeg could not start", error, redact);
  }

  const captured = captureStderr(child.stderr, redact);
  let settle!: (outcome: FfmpegOutcome) => void;
  let settled = false;
  let retiring = false;
  let failure: Error | undefined;
  const outcome = new Promise<FfmpegOutcome>(resolve => {
    settle = resolve;
  });
  const detachAbort = listenForAbort(signal, () => fail(abortError()));
  const cleanupInput = (): void => {
    input?.unpipe(child.stdin);
    if (input && !input.destroyed) input.destroy();
    opened?.cancel();
    if (!child.stdin.destroyed) child.stdin.destroy();
  };
  const complete = (code: number | null, processSignal: NodeJS.Signals | null, error?: Error): void => {
    if (settled) return;
    settled = true;
    detachAbort();
    cleanupInput();
    settle({ code, signal: processSignal, stderr: captured(), ...(error ? { error } : {}) });
  };
  function fail(error: Error): void {
    if (settled || retiring) return;
    failure ??= error;
    cleanupInput();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }

  child.on("error", error => {
    child.stdout.destroy();
    fail(safeInputError("FFmpeg could not start", error, redact));
  });
  child.stdout.on("error", error => fail(safeInputError("FFmpeg output pipe failed", error, redact)));
  child.stderr.on("error", () => undefined);
  child.stdin.on("error", error => fail(safeInputError("FFmpeg input pipe failed", error, redact)));
  child.once("close", (code, processSignal) => complete(code, processSignal, failure));
  if (input) {
    input.on("error", error => fail(safeInputError("Playback input failed", error, redact)));
    input.on("close", () => {
      if (!input.readableEnded) fail(new Error("Playback input closed before ending"));
    });
    if (input.errored) fail(safeInputError("Playback input failed", input.errored, redact));
    else if (input.destroyed) fail(new Error("Playback input was already destroyed"));
    else {
      try {
        input.pipe(child.stdin);
      } catch (error: unknown) {
        fail(safeInputError("Playback input pipe failed", error, redact));
      }
    }
  } else {
    child.stdin.end();
  }
  Object.defineProperties(child, {
    outcome: { value: outcome },
    [retireDecoder]: {
      value: () => {
        retiring = true;
        detachAbort();
        cleanupInput();
      },
    },
  });
  return child;
}

/** Ends a decoder run, including its input transport, and leaves terminal classification to its owner. */
export function killFfmpeg(stream: FfmpegStream): void {
  const retire = (stream as FfmpegStream & { [retireDecoder]?: () => void })[retireDecoder];
  retire?.();
  stream.stdout.destroy();
  stream.stderr.destroy();
  if (stream.exitCode === null && stream.signalCode === null) stream.kill("SIGKILL");
}

export function finishedFfmpeg(outcome: FfmpegOutcome): boolean {
  return outcome.error === undefined && outcome.code === 0 && outcome.signal === null;
}

/** Builds a bounded public decoder failure without exposing playable input or credentials. */
export function ffmpegFailure(outcome: FfmpegOutcome): Error {
  const safeCause = outcome.error ? safeError(outcome.error, boundedDiagnostic, errorBudget()) : undefined;
  const status = safeCause
    ? `FFmpeg operation failed: ${safeCause.message}`
    : outcome.signal
      ? `FFmpeg exited from signal ${outcome.signal}`
      : `FFmpeg exited with code ${outcome.code ?? "unknown"}`;
  const message = boundedDiagnostic(outcome.stderr ? `${status}: ${outcome.stderr}` : status);
  return safeCause ? new Error(message, { cause: safeCause }) : new Error(message);
}

async function openUrl(
  value: string,
  headers: Readonly<Record<string, string>> | undefined,
  signal: AbortSignal | undefined,
  redact: (value: string) => string,
): Promise<{ readonly response: IncomingMessage; readonly cancel: () => void }> {
  const url = new URL(value);
  const makeRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
  return await new Promise((resolve, reject) => {
    let request: ClientRequest | undefined;
    let acceptedResponse: IncomingMessage | undefined;
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Playback URL response headers timed out")), URL_READY_TIMEOUT_MS);
    const detachAbort = listenForAbort(signal, () => finish(abortError()));
    const finish = (error: Error, response?: IncomingMessage): void => {
      if (settled) return;
      settled = true;
      detachAbort();
      clearTimeout(timer);
      response?.destroy();
      request?.destroy();
      reject(error);
    };
    try {
      request = makeRequest(url, { headers: headers ? { ...headers } : undefined, method: "GET" }, response => {
        response.on("error", () => undefined);
        if (settled) {
          response.destroy();
          return;
        }
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          finish(
            new Error(
              status >= 300 && status < 400 ? "Playback URL redirected" : "Playback URL returned a non-success status",
            ),
            response,
          );
          return;
        }
        const contentType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType && MANIFEST_CONTENT_TYPES.has(contentType)) {
          finish(new Error("Playback URL returned a nested media manifest"), response);
          return;
        }
        settled = true;
        acceptedResponse = response;
        clearTimeout(timer);
        detachAbort();
        resolve({
          response,
          cancel: () => {
            response.destroy();
            request?.destroy();
          },
        });
      });
      request.once("error", error => {
        const failure = safeInputError("Playback URL request failed", error, redact);
        if (acceptedResponse) acceptedResponse.destroy(failure);
        else finish(failure);
      });
      if (signal?.aborted) {
        finish(abortError());
        return;
      }
      request.end();
    } catch (error: unknown) {
      finish(safeInputError("Playback URL request failed", error, redact));
    }
  });
}

function listenForAbort(signal: AbortSignal | undefined, abort: () => void): () => void {
  if (!signal) return () => undefined;
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function abortError(): Error {
  return new DOMException("The decoder operation was aborted", "AbortError");
}

function safeInputError(label: string, value: unknown, redact: (value: string) => string): Error {
  const cause = safeError(value, redact, errorBudget());
  return new Error(boundUtf8(`${label}: ${cause.message}`, 512), { cause });
}

interface ErrorBudget {
  readonly seen: WeakSet<object>;
  nodes: number;
  bytes: number;
}

function errorBudget(): ErrorBudget {
  return { seen: new WeakSet(), nodes: 0, bytes: MAX_STDERR_BYTES };
}

/** Copies only safe error fields; native errors and their arbitrary properties never escape. */
function safeError(value: unknown, redact: (value: string) => string, budget: ErrorBudget, depth = 0): Error {
  if (depth >= MAX_ERROR_DEPTH || budget.nodes >= MAX_ERROR_NODES) return new Error("Error cause truncated");
  if (!(value instanceof Error)) return new Error("Non-error cause");
  if (budget.seen.has(value)) return new Error("Cyclic error cause");
  budget.seen.add(value);
  budget.nodes += 1;
  const safeText = (text: string): string => {
    const result = boundUtf8(redact(text), budget.bytes);
    budget.bytes -= Buffer.byteLength(result, "utf8");
    return result;
  };
  try {
    const name = safeText(value.name);
    const code = Object.getOwnPropertyDescriptor(value, "code");
    const safeCode = code && "value" in code && typeof code.value === "string" ? safeText(code.value) : code?.value;
    const message = safeText(value.message);
    const cause = Object.getOwnPropertyDescriptor(value, "cause");
    const safeCause = cause && "value" in cause ? safeError(cause.value, redact, budget, depth + 1) : undefined;
    const errors = Object.getOwnPropertyDescriptor(value, "errors");
    const children: Error[] = [];
    if (value instanceof AggregateError && errors && "value" in errors && Array.isArray(errors.value)) {
      for (let index = 0; index < errors.value.length && budget.nodes < MAX_ERROR_NODES; index += 1) {
        const child = Object.getOwnPropertyDescriptor(errors.value, String(index));
        children.push(safeError(child && "value" in child ? child.value : undefined, redact, budget, depth + 1));
      }
    }
    const safe =
      value instanceof AggregateError
        ? new AggregateError(children, message, safeCause ? { cause: safeCause } : undefined)
        : new Error(message, safeCause ? { cause: safeCause } : undefined);
    safe.name = name;
    if (typeof safeCode === "string" || (typeof safeCode === "number" && Number.isFinite(safeCode))) {
      Object.defineProperty(safe, "code", { value: safeCode, enumerable: true });
    }
    return safe;
  } catch {
    return new Error("Uninspectable error cause");
  }
}

function captureStderr(stderr: Readable, redact: (value: string) => string): () => string {
  let tail = Buffer.alloc(0);
  let truncated = false;
  stderr.on("data", (value: string | Buffer) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (chunk.length >= MAX_STDERR_BYTES) {
      truncated = true;
      tail = Buffer.from(chunk.subarray(chunk.length - MAX_STDERR_BYTES));
      return;
    }
    const combined = Buffer.concat([tail, chunk]);
    truncated ||= combined.length > MAX_STDERR_BYTES;
    tail = Buffer.from(combined.subarray(Math.max(0, combined.length - MAX_STDERR_BYTES)));
  });
  return () => {
    // Drop a clipped first line; it may start halfway through a private credential.
    const completeLines = truncated ? tail.subarray(tail.indexOf(10) < 0 ? tail.length : tail.indexOf(10) + 1) : tail;
    return redact(completeLines.toString("utf8"));
  };
}

function boundedDiagnostic(value: string): string {
  return boundUtf8(redactDiagnostic(value), MAX_STDERR_BYTES);
}

function redactDiagnostic(value: string): string {
  return value
    .replace(/\b(?:https?|wss?|rtmp):\/\/[^\s<>"'`\\]+/giu, "<redacted-url>")
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:[^\s<>:"'`\\]+\/)+)[^\s<>:"'`\\]*/gu, "<redacted-path>")
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
