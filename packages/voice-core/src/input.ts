import { type ClientRequest, request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";
import type { InputSource, WireError } from "./pipeline-worker";
import type { LocalPlaybackResource } from "./validation";

export const MAX_DIAGNOSTIC_BYTES = 4096;
export const MAX_ERROR_DEPTH = 4;
export const MAX_ERROR_NODES = 12;
export const WINDOW_BYTES = 256 * 1024;
export const URL_READY_TIMEOUT_MS = 10_000;
const MANIFEST_CONTENT_TYPES = new Set([
  "application/dash+xml",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);

export function isSeekable(resource: LocalPlaybackResource): boolean {
  return resource.kind !== "stream" && (resource.kind !== "url" || resource.seekable === true);
}

/** One answer to a worker read: a chunk, the end of the range or stream, or a failure. */
export type ByteReply = Readonly<{ request: number; chunk?: ArrayBuffer; done?: boolean; failed?: boolean }>;

/** Serves one input's bytes to the worker on request; its `failure` is the safe cause behind a failed read. */
export interface ByteServer {
  readonly source: InputSource;
  readonly failure: Error | undefined;
  read(request: number, range: Readonly<{ start?: number; end?: number; want?: number }>): void;
  cancel(request: number): void;
  close(): void;
}

/** Opens `resource` at `seconds` on the main thread, where plugin callbacks, Readables and HTTP live. */
export async function serveInput(
  resource: LocalPlaybackResource,
  seconds: number,
  signal: AbortSignal,
  redact: (value: string) => string,
  reply: (message: ByteReply) => void,
): Promise<ByteServer> {
  const lifetime = new AbortController();
  try {
    switch (resource.kind) {
      case "file":
        return new FileServer(resource.path, lifetime);
      case "stream":
        return new OneShotServer(resource.stream, undefined, lifetime, redact, reply);
      case "timed":
        return new OneShotServer(resource.open(seconds, lifetime.signal), resource.container, lifetime, redact, reply);
      case "reader":
        return new RangedServer(resource.size, resource.container, resource.read, lifetime, redact, reply);
      case "url": {
        if (resource.seekable !== true) {
          const opened = await openUrl(resource.url, resource.headers, signal, redact);
          return new OneShotServer(opened.response, undefined, lifetime, redact, reply);
        }
        const first = await openUrl(resource.url, resource.headers, signal, redact, {
          start: 0,
          end: WINDOW_BYTES - 1,
        });
        if (first.size === undefined) return new OneShotServer(first.response, undefined, lifetime, redact, reply);
        let initial: Readable | undefined = first.response;
        return new RangedServer(
          first.size,
          undefined,
          async (start, end, abort) => {
            if (initial && start === 0) {
              const response = initial;
              initial = undefined;
              return response;
            }
            initial?.destroy();
            initial = undefined;
            return (await openUrl(resource.url, resource.headers, abort, redact, { start, end })).response;
          },
          lifetime,
          redact,
          reply,
        );
      }
    }
  } catch (error: unknown) {
    lifetime.abort();
    throw error;
  }
}

class FileServer implements ByteServer {
  readonly source: InputSource;
  readonly failure = undefined;
  readonly #lifetime: AbortController;

  constructor(path: string, lifetime: AbortController) {
    this.source = { kind: "file", path };
    this.#lifetime = lifetime;
  }

  read(): void {}

  cancel(): void {}

  close(): void {
    this.#lifetime.abort();
  }
}

class OneShotServer implements ByteServer {
  readonly source: InputSource;
  failure: Error | undefined;
  readonly #readable: Readable;
  readonly #lifetime: AbortController;
  readonly #redact: (value: string) => string;
  readonly #reply: (message: ByteReply) => void;
  #pending?: { readonly request: number; readonly want: number };
  #ended = false;
  #released = false;
  #stalled?: NodeJS.Timeout;

  constructor(
    readable: Readable,
    container: "webm" | "mp4" | undefined,
    lifetime: AbortController,
    redact: (value: string) => string,
    reply: (message: ByteReply) => void,
  ) {
    this.source = container ? { kind: "oneshot", container } : { kind: "oneshot" };
    this.#readable = readable;
    this.#lifetime = lifetime;
    this.#redact = redact;
    this.#reply = reply;
    readable.on("readable", this.#serve);
    readable.on("end", this.#onEnd);
    readable.on("error", this.#onError);
    readable.on("close", this.#onClose);
    if (readable.errored) this.#onError(readable.errored);
    else if (readable.destroyed) this.#settle(new Error("Playback input was already destroyed"));
  }

  read(request: number, { want = WINDOW_BYTES }: Readonly<{ want?: number }>): void {
    this.#pending = { request, want };
    this.#serve();
    if (this.#pending) this.#stalled ??= setTimeout(() => this.#settle(stalledError()), URL_READY_TIMEOUT_MS);
  }

  cancel(): void {}

  close(): void {
    this.#pending = undefined;
    this.#release();
    this.#lifetime.abort();
  }

  #answer(message: ByteReply): void {
    this.#pending = undefined;
    clearTimeout(this.#stalled);
    this.#stalled = undefined;
    this.#reply(message);
  }

  #release(): void {
    clearTimeout(this.#stalled);
    this.#stalled = undefined;
    if (this.#released) return;
    this.#released = true;
    this.#readable.off("readable", this.#serve);
    this.#readable.off("end", this.#onEnd);
    this.#readable.off("close", this.#onClose);
    this.#readable.on("error", () => undefined);
    this.#readable.off("error", this.#onError);
    if (!this.#readable.destroyed) this.#readable.destroy();
  }

  readonly #serve = (): void => {
    const pending = this.#pending;
    if (!pending) return;
    if (this.failure) {
      this.#answer({ request: pending.request, failed: true });
      return;
    }
    const parts: Buffer[] = [];
    let size = 0;
    while (size < pending.want) {
      const chunk: unknown = this.#readable.read();
      if (chunk === null) break;
      const bytes = toBuffer(chunk);
      parts.push(bytes);
      size += bytes.length;
    }
    if (size > 0) this.#answer({ request: pending.request, chunk: transferable(Buffer.concat(parts, size)) });
    else if (this.#ended) this.#answer({ request: pending.request, done: true });
  };

  readonly #onEnd = (): void => {
    this.#ended = true;
    this.#serve();
  };

  readonly #onError = (error: Error): void => {
    this.#settle(safeInputError("Playback input failed", error, this.#redact));
  };

  readonly #onClose = (): void => {
    if (!this.#readable.readableEnded) this.#settle(new Error("Playback input closed before ending"));
  };

  #settle(failure: Error): void {
    this.failure ??= failure;
    this.#release();
    this.#serve();
  }
}

type RangeOpener = (start: number, end: number, signal: AbortSignal) => Readable | Promise<Readable>;

class RangedServer implements ByteServer {
  readonly source: InputSource;
  failure: Error | undefined;
  readonly #open: RangeOpener;
  readonly #lifetime: AbortController;
  readonly #redact: (value: string) => string;
  readonly #reply: (message: ByteReply) => void;
  readonly #requests = new Map<number, AbortController>();

  constructor(
    size: number,
    container: "webm" | "mp4" | undefined,
    open: RangeOpener,
    lifetime: AbortController,
    redact: (value: string) => string,
    reply: (message: ByteReply) => void,
  ) {
    this.source = container ? { kind: "ranged", size, container } : { kind: "ranged", size };
    this.#open = open;
    this.#lifetime = lifetime;
    this.#redact = redact;
    this.#reply = reply;
  }

  read(request: number, { start = 0, end = 0 }: Readonly<{ start?: number; end?: number }>): void {
    const controller = new AbortController();
    this.#requests.set(request, controller);
    void this.#stream(request, start, end, controller.signal).finally(() => this.#requests.delete(request));
  }

  cancel(request: number): void {
    this.#requests.get(request)?.abort();
  }

  close(): void {
    for (const controller of this.#requests.values()) controller.abort();
    this.#lifetime.abort();
  }

  async #stream(request: number, start: number, end: number, cancelled: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([cancelled, this.#lifetime.signal]);
    const stall = new AbortController();
    const active = AbortSignal.any([signal, stall.signal]);
    let stalled: NodeJS.Timeout | undefined;
    const arm = (): void => {
      clearTimeout(stalled);
      stalled = setTimeout(() => stall.abort(stalledError()), URL_READY_TIMEOUT_MS);
    };
    let readable: Readable | undefined;
    arm();
    try {
      const opened = await this.#open(start, end, active);
      readable = opened;
      active.throwIfAborted();
      active.addEventListener("abort", () => opened.destroy(active.reason), { once: true });
      const length = end - start + 1;
      let received = 0;
      for await (const chunk of opened) {
        arm();
        if (signal.aborted) return;
        const bytes = toBuffer(chunk);
        received += bytes.length;
        if (received > length) {
          return this.#fail(request, opened, "Playback input returned more bytes than its range");
        }
        this.#reply({ request, chunk: transferable(bytes) });
        if (received === length) break;
      }
      if (signal.aborted) return;
      if (received < length) return this.#fail(request, opened, "Playback input ended before its byte range");
      this.#reply({ request, done: true });
    } catch (error: unknown) {
      readable?.destroy();
      if (signal.aborted) return;
      this.failure ??= safeInputError(
        "Playback input failed",
        stall.signal.aborted ? stall.signal.reason : error,
        this.#redact,
      );
      this.#reply({ request, failed: true });
    } finally {
      clearTimeout(stalled);
    }
  }

  #fail(request: number, readable: Readable, message: string): void {
    readable.destroy();
    this.failure ??= new Error(message);
    this.#reply({ request, failed: true });
  }
}

function stalledError(): Error {
  return new Error("Playback input stopped sending bytes");
}

function transferable(bytes: Buffer): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (typeof chunk === "string") return Buffer.from(chunk);
  throw new TypeError("Playback input must yield bytes");
}

interface OpenedUrl {
  readonly response: IncomingMessage;
  readonly size?: number;
}

async function openUrl(
  value: string,
  headers: Readonly<Record<string, string>> | undefined,
  signal: AbortSignal,
  redact: (value: string) => string,
  range?: { readonly start: number; readonly end: number },
): Promise<OpenedUrl> {
  const url = new URL(value);
  const makeRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
  const requestHeaders = { ...headers, ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) };
  return await new Promise((resolve, reject) => {
    let request: ClientRequest | undefined;
    let acceptedResponse: IncomingMessage | undefined;
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Playback URL response headers timed out")), URL_READY_TIMEOUT_MS);
    const detachAbort = listenForAbort(signal, () => finish(abortError()));
    const finish = (error: Error, response?: IncomingMessage): void => {
      if (settled) {
        acceptedResponse?.destroy(error);
        return;
      }
      settled = true;
      detachAbort();
      clearTimeout(timer);
      response?.destroy();
      request?.destroy();
      reject(error);
    };
    try {
      request = makeRequest(url, { headers: requestHeaders, method: "GET" }, response => {
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
        const size = status === 206 ? rangeSize(response.headers["content-range"]) : undefined;
        if (range && range.start > 0 && size === undefined) {
          finish(new Error("Playback URL ignored the requested byte range"), response);
          return;
        }
        settled = true;
        acceptedResponse = response;
        clearTimeout(timer);
        detachAbort();
        const detachCancel = listenForAbort(signal, () => response.destroy(abortError()));
        response.once("close", detachCancel);
        resolve({ response, ...(size === undefined ? {} : { size }) });
      });
      request.once("error", error => finish(safeInputError("Playback URL request failed", error, redact)));
      if (signal.aborted) {
        finish(abortError());
        return;
      }
      request.end();
    } catch (error: unknown) {
      finish(safeInputError("Playback URL request failed", error, redact));
    }
  });
}

function rangeSize(header: string | undefined): number | undefined {
  const total = header?.match(/^bytes \d+-\d+\/(\d+)$/u)?.[1];
  const size = total === undefined ? Number.NaN : Number(total);
  return Number.isSafeInteger(size) && size > 0 ? size : undefined;
}

function listenForAbort(signal: AbortSignal, abort: () => void): () => void {
  if (signal.aborted) {
    abort();
    return () => undefined;
  }
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export function abortError(): Error {
  return new DOMException("The playback operation was aborted", "AbortError");
}

/** Redacts the resource's own URL, header values and path, then known credential shapes, within the budget. */
export function redactor(resource: LocalPlaybackResource): (value: string) => string {
  const privateValues =
    resource.kind === "url"
      ? [resource.url, ...Object.values(resource.headers ?? {})]
      : resource.kind === "file"
        ? [resource.path]
        : [];
  return value => {
    for (const secret of privateValues) if (secret) value = value.split(secret).join("<redacted>");
    return boundedDiagnostic(value);
  };
}

export function decodeFailure(stage: string, error: unknown, redact: (value: string) => string): Error {
  const cause = safeError(error, redact);
  return new Error(redact(`Decode failed during ${stage}: ${cause.message}`), { cause });
}

export function fromWire(wire: WireError): Error {
  const cause = wire.cause ? { cause: fromWire(wire.cause) } : undefined;
  const error = wire.errors
    ? new AggregateError(wire.errors.map(fromWire), wire.message, cause)
    : new Error(wire.message, cause);
  error.name = wire.name;
  if (wire.code !== undefined) Object.defineProperty(error, "code", { value: wire.code, enumerable: true });
  return error;
}

export function safeInputError(label: string, value: unknown, redact: (value: string) => string): Error {
  const cause = safeError(value, redact, errorBudget());
  return new Error(boundUtf8(`${label}: ${cause.message}`, 512), { cause });
}

interface ErrorBudget {
  readonly seen: WeakSet<object>;
  nodes: number;
  bytes: number;
}

function errorBudget(): ErrorBudget {
  return { seen: new WeakSet(), nodes: 0, bytes: MAX_DIAGNOSTIC_BYTES };
}

export function safeError(value: unknown, redact: (value: string) => string, budget = errorBudget(), depth = 0): Error {
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

function boundedDiagnostic(value: string): string {
  return boundUtf8(redactDiagnostic(value), MAX_DIAGNOSTIC_BYTES);
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
