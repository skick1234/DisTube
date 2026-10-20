import { validateHeaderName, validateHeaderValue } from "node:http";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import type { PlaybackPreparation, PlaybackResource } from "../contracts";
import { DisTubeError, ErrorCode, malformedValue } from "../errors";

const URL_RESOURCE_KEYS = new Set(["kind", "url", "headers", "seekable", "dispose"]);
const FILE_RESOURCE_KEYS = new Set(["kind", "path", "dispose"]);
const STREAM_RESOURCE_KEYS = new Set(["kind", "stream", "dispose"]);
const ENCODED_RESOURCE_KEYS = new Set(["kind", "format", "encoded", "seekable", "dispose"]);
const RESOURCE_PREPARATION_KEYS = new Set(["kind", "resource"]);
const SEARCH_PREPARATION_KEYS = new Set(["kind", "query"]);

export function validateSourceName(value: unknown, label = "SourcePlugin name"): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new DisTubeError("INVALID_ARGUMENT", `${label} must be a trimmed non-empty string`);
  }
  return value;
}

export function validatePlaybackPreparation(
  value: unknown,
  code: ErrorCode = ErrorCode.INVALID_ARGUMENT,
): PlaybackPreparation {
  const record = asRecord(value, "Playback preparation must be an object", code);
  if (record.kind === "resource") {
    assertExactKeys(record, RESOURCE_PREPARATION_KEYS, "Resource preparation", code);
    return Object.freeze({ kind: "resource", resource: validatePlaybackResource(record.resource, code) });
  }
  if (record.kind === "search") {
    assertExactKeys(record, SEARCH_PREPARATION_KEYS, "Search preparation", code);
    if (typeof record.query !== "string" || record.query.trim().length === 0) {
      throw malformedValue(code, "Search preparation query must be non-empty");
    }
    return Object.freeze({ kind: "search", query: record.query.trim() });
  }
  throw malformedValue(code, "Playback preparation kind must be resource or search");
}

export function validatePlaybackResource(
  value: unknown,
  code: ErrorCode = ErrorCode.INVALID_ARGUMENT,
): PlaybackResource {
  const record = asRecord(value, "Playback resource must be an object", code);
  if (record.kind === "url") {
    assertExactKeys(record, URL_RESOURCE_KEYS, "URL playback resource", code);
    const url = parseHttpUrl(record.url);
    if (!url || url.username.length > 0 || url.password.length > 0) {
      throw malformedValue(code, "URL playback resource must contain an absolute HTTP(S) URL");
    }
    const headers = validateHeaders(record.headers, code);
    const seekable = validateSeekable(record.seekable, code);
    validateDisposer(record.dispose, code);
    return Object.freeze({
      kind: "url",
      url: url.href,
      ...(headers ? { headers } : {}),
      ...(seekable === undefined ? {} : { seekable }),
      ...(typeof record.dispose === "function" ? { dispose: record.dispose.bind(value) } : {}),
    });
  }
  if (record.kind === "file") {
    assertExactKeys(record, FILE_RESOURCE_KEYS, "File playback resource", code);
    if (typeof record.path !== "string" || !isAbsolute(record.path)) {
      throw malformedValue(code, "File playback resource must contain an absolute path");
    }
    validateDisposer(record.dispose, code);
    return Object.freeze({
      kind: "file",
      path: record.path,
      ...(typeof record.dispose === "function" ? { dispose: record.dispose.bind(value) } : {}),
    });
  }
  if (record.kind === "stream") {
    assertExactKeys(record, STREAM_RESOURCE_KEYS, "Stream playback resource", code);
    if (!(record.stream instanceof Readable)) {
      throw malformedValue(code, "Stream playback resource must contain a Node Readable");
    }
    validateDisposer(record.dispose, code);
    return Object.freeze({
      kind: "stream",
      stream: record.stream,
      ...(typeof record.dispose === "function" ? { dispose: record.dispose.bind(value) } : {}),
    });
  } else if (record.kind === "encoded") {
    assertExactKeys(record, ENCODED_RESOURCE_KEYS, "Encoded playback resource", code);
    if (typeof record.format !== "string" || record.format.length === 0 || record.format !== record.format.trim()) {
      throw malformedValue(code, "Encoded playback resource must contain a non-empty format");
    }
    if (typeof record.encoded !== "string" || record.encoded.length === 0) {
      throw malformedValue(code, "Encoded playback resource must contain a non-empty encoded track");
    }
    const seekable = validateSeekable(record.seekable, code);
    validateDisposer(record.dispose, code);
    return Object.freeze({
      kind: "encoded",
      format: record.format,
      encoded: record.encoded,
      ...(seekable === undefined ? {} : { seekable }),
      ...(typeof record.dispose === "function" ? { dispose: record.dispose.bind(value) } : {}),
    });
  } else {
    throw malformedValue(code, "Playback resource kind must be url, file, stream, or encoded");
  }
}

function asRecord(value: unknown, message: string, code: ErrorCode): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw malformedValue(code, message);
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
  code: ErrorCode,
): void {
  if (Object.keys(record).some(key => !allowed.has(key))) {
    throw malformedValue(code, `${label} contains unsupported fields`);
  }
}

function parseHttpUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}

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

function validateHeaders(value: unknown, code: ErrorCode): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, "URL playback resource headers must be an object", code);
  const headers: Record<string, string> = Object.create(null);
  for (const [name, headerValue] of Object.entries(record)) {
    // HTTP permits tabs; playback headers reject all control characters.
    // oxlint-disable-next-line no-control-regex -- reject HTTP header controls
    if (typeof headerValue !== "string" || /[\x00-\x1f\x7f]/u.test(headerValue)) {
      throw malformedValue(code, "URL playback resource contains an invalid header value");
    }
    try {
      validateHeaderName(name);
      validateHeaderValue(name, headerValue);
    } catch {
      throw malformedValue(code, "URL playback resource contains an invalid header");
    }
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
      throw malformedValue(code, "URL playback resource contains a forbidden header name");
    }
    headers[name] = headerValue;
  }
  return Object.freeze(headers);
}

function validateSeekable(value: unknown, code: ErrorCode): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw malformedValue(code, "Playback resource seekable must be a boolean");
  }
  return value as boolean | undefined;
}

function validateDisposer(value: unknown, code: ErrorCode): void {
  if (value !== undefined && typeof value !== "function") {
    throw malformedValue(code, "Playback resource dispose must be callable");
  }
}
