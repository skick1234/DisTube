import type { PlaybackPreparation, PlaybackRequest, PlaybackResource } from "../contracts";
import { DisTubeError, ErrorCode, malformedValue } from "../errors";

const URL_RESOURCE_KEYS = new Set(["kind", "url", "dispose"]);
const ENCODED_RESOURCE_KEYS = new Set(["kind", "encoded", "dispose"]);
const REQUEST_KEYS = new Set(["itemId", "resource"]);
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
    if (typeof record.url !== "string" || !isAbsoluteHttpUrl(record.url)) {
      throw malformedValue(code, "URL playback resource must contain an absolute HTTP(S) URL");
    }
  } else if (record.kind === "encoded") {
    assertExactKeys(record, ENCODED_RESOURCE_KEYS, "Encoded playback resource", code);
    if (typeof record.encoded !== "string" || record.encoded.length === 0) {
      throw malformedValue(code, "Encoded playback resource must contain a non-empty encoded track");
    }
  } else {
    throw malformedValue(code, "Playback resource kind must be url or encoded");
  }
  if (typeof record.dispose !== "function") {
    throw malformedValue(code, "Playback resource must provide dispose()");
  }
  return value as PlaybackResource;
}

export function validatePlaybackRequest(value: unknown): PlaybackRequest {
  const record = asRecord(value, "Playback request must be an object", ErrorCode.INVALID_ARGUMENT);
  assertExactKeys(record, REQUEST_KEYS, "Playback request", ErrorCode.INVALID_ARGUMENT);
  if (typeof record.itemId !== "string" || record.itemId.length === 0 || record.itemId !== record.itemId.trim()) {
    throw new DisTubeError("INVALID_ARGUMENT", "Playback request itemId must be a trimmed non-empty string");
  }
  return Object.freeze({ itemId: record.itemId, resource: validatePlaybackResource(record.resource) });
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
  if (Object.keys(record).some(key => !allowed.has(key)) || Object.keys(record).length !== allowed.size) {
    throw malformedValue(code, `${label} contains unsupported fields`);
  }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}
