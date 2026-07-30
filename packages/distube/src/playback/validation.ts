import type { PlaybackPreparation, PlaybackRequest, UrlPlaybackResource } from "../contracts";
import { DisTubeError, ErrorCode } from "../errors";

const RESOURCE_KEYS = new Set(["kind", "url", "dispose"]);
const REQUEST_KEYS = new Set(["itemId", "resource"]);
const RESOURCE_PREPARATION_KEYS = new Set(["kind", "resource"]);
const SEARCH_PREPARATION_KEYS = new Set(["kind", "query"]);

export function validateSourceName(value: unknown, label = "SourcePlugin name"): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${label} must be a trimmed non-empty string`);
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
    return Object.freeze({ kind: "resource", resource: validateUrlPlaybackResource(record.resource, code) });
  }
  if (record.kind === "search") {
    assertExactKeys(record, SEARCH_PREPARATION_KEYS, "Search preparation", code);
    if (typeof record.query !== "string" || record.query.trim().length === 0) {
      throw new DisTubeError(code, "Search preparation query must be non-empty");
    }
    return Object.freeze({ kind: "search", query: record.query.trim() });
  }
  throw new DisTubeError(code, "Playback preparation kind must be resource or search");
}

export function validateUrlPlaybackResource(
  value: unknown,
  code: ErrorCode = ErrorCode.INVALID_ARGUMENT,
): UrlPlaybackResource {
  const record = asRecord(value, "URL playback resource must be an object", code);
  assertExactKeys(record, RESOURCE_KEYS, "URL playback resource", code);
  if (record.kind !== "url") {
    throw new DisTubeError(code, "URL playback resource kind must be url");
  }
  if (typeof record.url !== "string" || !isAbsoluteHttpUrl(record.url)) {
    throw new DisTubeError(code, "URL playback resource must contain an absolute HTTP(S) URL");
  }
  if (typeof record.dispose !== "function") {
    throw new DisTubeError(code, "URL playback resource must provide dispose()");
  }
  return value as UrlPlaybackResource;
}

export function validatePlaybackRequest(value: unknown): PlaybackRequest {
  const record = asRecord(value, "Playback request must be an object", ErrorCode.INVALID_ARGUMENT);
  assertExactKeys(record, REQUEST_KEYS, "Playback request", ErrorCode.INVALID_ARGUMENT);
  if (typeof record.itemId !== "string" || record.itemId.length === 0 || record.itemId !== record.itemId.trim()) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Playback request itemId must be a trimmed non-empty string");
  }
  return Object.freeze({ itemId: record.itemId, resource: validateUrlPlaybackResource(record.resource) });
}

function asRecord(value: unknown, message: string, code: ErrorCode): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DisTubeError(code, message);
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
    throw new DisTubeError(code, `${label} contains unsupported fields`);
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
