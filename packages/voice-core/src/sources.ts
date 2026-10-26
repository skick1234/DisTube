import { type ClientRequest, request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";
import type { EncodedPlaybackResource, PlaybackResource } from "distube/integrations";
import { type InputSource, URL_READY_TIMEOUT_MS, WINDOW_BYTES, type WireError } from "./protocol";

export type LocalPlaybackResource = Exclude<PlaybackResource, EncodedPlaybackResource>;

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HLS_CONTENT_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);

export function isSeekable(resource: LocalPlaybackResource): boolean {
  return resource.kind !== "stream" && resource.kind !== "url";
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
        return new DirectServer({ kind: "file", path: resource.path }, lifetime);
      case "stream":
        return new OneShotServer(resource.stream, undefined, lifetime, redact, reply);
      case "timed":
        return new OneShotServer(resource.open(seconds, lifetime.signal), resource.container, lifetime, redact, reply);
      case "reader":
        return new RangedServer(resource.size, resource.container, resource.read, lifetime, redact, reply);
      case "url": {
        const opened = await openUrl(resource.url, signal, redact);
        return typeof opened === "string"
          ? new DirectServer({ kind: "hls", url: opened }, lifetime)
          : new OneShotServer(opened, undefined, lifetime, redact, reply);
      }
    }
  } catch (error: unknown) {
    lifetime.abort();
    throw error;
  }
}

/** An input the worker's libav opens by path or URL, so no bytes pass through this server. */
class DirectServer implements ByteServer {
  readonly source: InputSource;
  readonly failure = undefined;
  readonly #lifetime: AbortController;

  constructor(source: InputSource, lifetime: AbortController) {
    this.source = source;
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

async function openUrl(
  value: string,
  signal: AbortSignal,
  redact: (value: string) => string,
): Promise<IncomingMessage | string> {
  return await new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let request: ClientRequest | undefined;
    let acceptedResponse: IncomingMessage | undefined;
    let settled = false;
    let redirects = 0;
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
    const timer = setTimeout(() => finish(new Error("Playback URL response headers timed out")), URL_READY_TIMEOUT_MS);
    const detachAbort = listenForAbort(signal, () => finish(abortError()));
    const send = (target: URL): void => {
      try {
        const makeRequest = target.protocol === "https:" ? httpsRequest : httpRequest;
        const sent = makeRequest(target, { method: "GET" }, response => {
          response.on("error", () => undefined);
          if (settled) {
            response.destroy();
            return;
          }
          const status = response.statusCode ?? 0;
          const location = REDIRECT_STATUSES.has(status) ? response.headers.location : undefined;
          if (location !== undefined) {
            if (redirects === MAX_REDIRECTS) {
              return finish(new Error("Playback URL redirected too many times"), response);
            }
            const next = URL.parse(location, target.href);
            if (next?.protocol !== "http:" && next?.protocol !== "https:") {
              return finish(new Error("Playback URL redirected to a non-HTTP location"), response);
            }
            response.destroy();
            sent.destroy();
            redirects += 1;
            send(next);
            return;
          }
          if (status < 200 || status >= 300) {
            finish(new Error("Playback URL returned a non-success status"), response);
            return;
          }
          const contentType = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
          if (contentType === "application/dash+xml") {
            finish(new Error("Playback URL returned a DASH manifest"), response);
            return;
          }
          if (contentType && HLS_CONTENT_TYPES.has(contentType)) {
            settled = true;
            clearTimeout(timer);
            detachAbort();
            response.destroy();
            sent.destroy();
            resolve(target.href);
            return;
          }
          settled = true;
          acceptedResponse = response;
          clearTimeout(timer);
          detachAbort();
          const detachCancel = listenForAbort(signal, () => response.destroy(abortError()));
          response.once("close", detachCancel);
          resolve(response);
        });
        request = sent;
        sent.once("error", error => {
          if (request === sent) finish(safeInputError("Playback URL request failed", error, redact));
        });
        sent.end();
      } catch (error: unknown) {
        finish(safeInputError("Playback URL request failed", error, redact));
      }
    };
    send(new URL(value));
  });
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

export function redactor(resource: LocalPlaybackResource): (value: string) => string {
  const secret = resource.kind === "url" ? resource.url : resource.kind === "file" ? resource.path : undefined;
  return value => (secret ? value.split(secret).join("<redacted>") : value);
}

export function decodeFailure(stage: string, error: unknown, redact: (value: string) => string): Error {
  const cause = safeError(error, redact);
  return new Error(redact(`Decode failed during ${stage}: ${cause.message}`), { cause });
}

export function fromWire(wire: WireError): Error {
  const error = new Error(wire.message, wire.cause ? { cause: fromWire(wire.cause) } : undefined);
  error.name = wire.name;
  return wire.code === undefined ? error : Object.assign(error, { code: wire.code });
}

function safeInputError(label: string, value: unknown, redact: (value: string) => string): Error {
  const cause = safeError(value, redact);
  return new Error(`${label}: ${cause.message}`, { cause });
}

export function safeError(value: unknown, redact: (value: string) => string, withCause = true): Error {
  if (!(value instanceof Error)) return new Error("Non-error cause");
  const cause = withCause && value.cause !== undefined ? { cause: safeError(value.cause, redact, false) } : undefined;
  const safe = new Error(redact(value.message), cause);
  safe.name = value.name;
  const code: unknown = (value as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? Object.assign(safe, { code }) : safe;
}
