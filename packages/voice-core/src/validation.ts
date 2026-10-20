import { validateHeaderName, validateHeaderValue } from "node:http";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { DisTubeError } from "distube";
import type {
  FilePlaybackResource,
  PlaybackRequest,
  StreamPlaybackResource,
  UrlPlaybackResource,
} from "distube/integrations";

export type LocalPlaybackResource = UrlPlaybackResource | FilePlaybackResource | StreamPlaybackResource;

/** A playback request narrowed to the resource kinds supported by the official local engines. */
export type LocalPlaybackRequest = PlaybackRequest & { readonly resource: LocalPlaybackResource };

const REQUEST_KEYS = new Set(["itemId", "resource"]);
const URL_KEYS = new Set(["kind", "url", "headers", "seekable", "dispose"]);
const FILE_KEYS = new Set(["kind", "path", "dispose"]);
const STREAM_KEYS = new Set(["kind", "stream", "dispose"]);
const FORBIDDEN_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function playbackRequest(value: unknown): LocalPlaybackRequest {
  const request = record(value, "Playback request must be an object");
  assertKeys(request, REQUEST_KEYS, "Playback request");
  if (typeof request.itemId !== "string" || request.itemId.length === 0 || request.itemId !== request.itemId.trim()) {
    throw new TypeError("Playback request itemId must be a trimmed non-empty string");
  }
  return Object.freeze({ itemId: request.itemId, resource: localPlaybackResource(request.resource) });
}

/** Validates and snapshots one local input without freezing a caller-owned Readable. */
export function localPlaybackResource(value: unknown): LocalPlaybackResource {
  const candidate = record(value, "Playback resource must be an object");
  if (candidate.kind === "encoded") {
    throw new DisTubeError("UNSUPPORTED", "The default voice engine cannot play encoded resources");
  }
  const dispose = optionalDispose(candidate.dispose);
  if (candidate.kind === "url") {
    assertKeys(candidate, URL_KEYS, "URL playback resource");
    const url = playbackUrl(candidate.url);
    const headers = playbackHeaders(candidate.headers);
    if (candidate.seekable !== undefined && typeof candidate.seekable !== "boolean") {
      throw new TypeError("URL playback resource seekable must be a boolean");
    }
    return Object.freeze({
      kind: "url",
      url,
      ...(headers ? { headers } : {}),
      ...(candidate.seekable === undefined ? {} : { seekable: candidate.seekable }),
      ...(dispose ? { dispose } : {}),
    });
  }
  if (candidate.kind === "file") {
    assertKeys(candidate, FILE_KEYS, "File playback resource");
    if (typeof candidate.path !== "string" || !isAbsolute(candidate.path) || candidate.path.includes("\0")) {
      throw new TypeError("File playback resource must contain an absolute path");
    }
    return Object.freeze({ kind: "file", path: candidate.path, ...(dispose ? { dispose } : {}) });
  }
  if (candidate.kind === "stream") {
    assertKeys(candidate, STREAM_KEYS, "Stream playback resource");
    if (!(candidate.stream instanceof Readable)) {
      throw new TypeError("Stream playback resource must contain a Node Readable");
    }
    return Object.freeze({ kind: "stream", stream: candidate.stream, ...(dispose ? { dispose } : {}) });
  }
  throw new TypeError("Playback resource kind must be url, file or stream");
}

function playbackUrl(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("URL playback resource must contain an absolute HTTP(S) URL");
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) {
      throw new Error();
    }
  } catch {
    throw new TypeError("URL playback resource must contain an absolute HTTP(S) URL without userinfo");
  }
  return value;
}

function playbackHeaders(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const headers = record(value, "URL playback resource headers must be a record of strings");
  const snapshot: Record<string, string> = Object.create(null);
  for (const [name, headerValue] of Object.entries(headers)) {
    // HTTP validation permits tabs, but playback headers disallow every control character.
    // oxlint-disable-next-line no-control-regex -- reject HTTP header controls
    if (typeof headerValue !== "string" || /[\x00-\x1f\x7f]/u.test(headerValue))
      throw new TypeError("URL playback resource header values must be strings");
    try {
      validateHeaderName(name);
      validateHeaderValue(name, headerValue);
    } catch {
      throw new TypeError("URL playback resource contains an invalid header");
    }
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw new TypeError(`URL playback resource cannot override the ${name} header`);
    }
    snapshot[name] = headerValue;
  }
  return Object.freeze(snapshot);
}

function optionalDispose(value: unknown): (() => void | Promise<void>) | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "function") throw new TypeError("Playback resource dispose must be a function when supplied");
  return value as () => void | Promise<void>;
}

function record(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(message);
  return value as Readonly<Record<string, unknown>>;
}

function assertKeys(value: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>, label: string): void {
  if (Object.keys(value).some(key => !allowed.has(key))) throw new TypeError(`${label} contains unsupported fields`);
}
