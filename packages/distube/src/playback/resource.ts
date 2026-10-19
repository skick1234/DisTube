import { Readable } from "node:stream";
import type { Engine, PlaybackResource } from "../contracts";
import { asError, DisTubeError, type ErrorCode, type ErrorContext } from "../errors";
import { disposeOnce, settleAll } from "../utils/dispose";
import { validatePlaybackResource } from "./validation";

const claimedWrappers = new WeakSet<object>();
const claimedReadables = new WeakSet<Readable>();

export interface OwnedPlaybackResource {
  readonly resource: PlaybackResource;
  dispose(): Promise<void>;
}

/** Validates, snapshots, and synchronously consumes a fresh resource identity. */
export function consumePlaybackResource(value: unknown, code: ErrorCode = "INVALID_ARGUMENT"): OwnedPlaybackResource {
  const resource = validatePlaybackResource(value, code);
  return claim(value as object, resource);
}

/**
 * Captures a recognizable malformed source resource for best-effort cleanup.
 * Direct caller input never uses this path because malformed direct values remain caller-owned.
 */
export function capturePlaybackResource(value: unknown): OwnedPlaybackResource | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  if (!new Set(["url", "file", "stream", "encoded"]).has(record.kind as string)) return undefined;
  if (typeof record.dispose !== "function") return undefined;
  const stream = record.kind === "stream" && record.stream instanceof Readable ? record.stream : undefined;
  if (claimedWrappers.has(value) || (stream && claimedReadables.has(stream))) return undefined;
  claimedWrappers.add(value);
  if (stream) claimedReadables.add(stream);
  return owner(value as PlaybackResource, stream, async () => {
    await Reflect.apply(record.dispose as () => unknown, value, []);
  });
}

/** Rejects a valid resource that the selected engine cannot consume, before Player work. */
export function assertPlaybackResourceCompatible(resource: PlaybackResource, engine: Engine): void {
  if (!engine.accepts.has(resource.kind)) {
    throw new DisTubeError("UNSUPPORTED", `Engine does not accept ${resource.kind} playback resources`);
  }
  if (resource.kind === "encoded" && !engine.encodedFormats?.has(resource.format)) {
    throw new DisTubeError("UNSUPPORTED", "Engine does not accept this encoded playback format");
  }
  if (engine.supportsResource) {
    try {
      if (engine.supportsResource(resource) !== true) {
        throw new DisTubeError("UNSUPPORTED", "Engine does not accept these playback resource options");
      }
    } catch (error) {
      throw asError(error, resourceErrorContext(resource));
    }
  }
}

/** Keeps private input values out of errors from integrations borrowing the resource. */
export function resourceErrorContext(resource: PlaybackResource): ErrorContext {
  const values =
    resource.kind === "url"
      ? [resource.url, ...Object.values(resource.headers ?? {})]
      : resource.kind === "file"
        ? [resource.path]
        : resource.kind === "encoded"
          ? [resource.encoded]
          : [];
  return { sensitiveValues: values.filter(value => typeof value === "string") };
}

export function isPlaybackResourceSeekable(resource: PlaybackResource): boolean {
  return (
    resource.kind === "file" || ((resource.kind === "url" || resource.kind === "encoded") && resource.seekable === true)
  );
}

function claim(wrapper: object, resource: PlaybackResource): OwnedPlaybackResource {
  const stream = resource.kind === "stream" ? resource.stream : undefined;
  assertFresh(wrapper, stream);
  claimedWrappers.add(wrapper);
  if (stream) claimedReadables.add(stream);
  return owner(resource, stream, resource.dispose);
}

function assertFresh(wrapper: object, stream?: Readable): void {
  if (claimedWrappers.has(wrapper) || (stream && claimedReadables.has(stream))) {
    throw new DisTubeError("INVALID_STATE", "Playback resource has already been consumed");
  }
}

function owner(
  resource: PlaybackResource,
  stream: Readable | undefined,
  cleanup: (() => void | Promise<void>) | undefined,
): OwnedPlaybackResource {
  const once = disposeOnce(async () => {
    const failures = await settleAll([
      ...(stream
        ? [
            (): void => {
              stream.destroy();
            },
          ]
        : []),
      ...(cleanup ? [cleanup] : []),
    ]);
    if (failures.length > 0) {
      throw asError(new AggregateError(failures, "Playback resource cleanup failed"), resourceErrorContext(resource));
    }
  });
  return Object.freeze({ resource, dispose: once.dispose });
}
