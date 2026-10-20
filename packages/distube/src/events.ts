import type { Diagnostic } from "./contracts";
import type { DisTubeQueue } from "./DisTubeQueue";
import { asError, type DisTubeError, sanitizeDiagnosticText } from "./errors";
import type { Playlist, QueueItem, Song } from "./media";
import type { QueueState } from "./queue/state";
import type { DisTubeVoice } from "./voice/DisTubeVoice";
import type { VoiceChannelTarget } from "./voice/target";

export interface BaseQueueEvent<Metadata = unknown, Target = VoiceChannelTarget> {
  readonly guildId: string;
  /** The queue the transition committed on; its commands reject once it is deleted. */
  readonly queue: DisTubeQueue<Metadata, Target>;
  readonly state: QueueState<Metadata>;
  /** When the committing transition ran, not when the listener is called. */
  readonly timestamp: number;
}

export interface BaseVoiceEvent<Target = VoiceChannelTarget> {
  readonly guildId: string;
  readonly voice: DisTubeVoice<Target>;
  readonly timestamp: number;
}

/** A track the voice accepted; `itemId` is present when the caller supplied one, as DisTubeQueue does. */
export type VoiceTrackEvent<Target = VoiceChannelTarget> = Readonly<BaseVoiceEvent<Target> & { itemId?: string }>;

/** Why a guild's DisTubeVoice ended: the application left, the platform dropped it, or the client shut down. */
export type VoiceDisconnectReason = "left" | "platform" | "shutdown";

export interface DisTubeEventMap<Metadata = unknown, Target = VoiceChannelTarget> {
  "queue.created": Readonly<BaseQueueEvent<Metadata, Target>>;
  "queue.item.added": Readonly<BaseQueueEvent<Metadata, Target> & { item: QueueItem<Metadata> }>;
  /** One resolved Playlist committed as a collection; its items publish no per-item events. */
  "queue.playlist.added": Readonly<
    BaseQueueEvent<Metadata, Target> & { playlist: Playlist; items: readonly QueueItem<Metadata>[] }
  >;
  "queue.item.started": Readonly<BaseQueueEvent<Metadata, Target> & { item: QueueItem<Metadata> }>;
  "queue.item.finished": Readonly<BaseQueueEvent<Metadata, Target> & { item: QueueItem<Metadata> }>;
  "queue.item.failed": Readonly<BaseQueueEvent<Metadata, Target> & { item: QueueItem<Metadata>; error: DisTubeError }>;
  /** An ended occurrence entered the bounded history; follows the item's terminal outcome event. */
  "queue.history.added": Readonly<BaseQueueEvent<Metadata, Target> & { item: QueueItem<Metadata> }>;
  /** Playback ran out of successors; the queue deletes itself next. */
  "queue.finished": Readonly<BaseQueueEvent<Metadata, Target>>;
  /** The reference Song had no autoplay continuation, so the queue proceeds to exhaustion. */
  "queue.autoplay.failed": Readonly<BaseQueueEvent<Metadata, Target> & { song: Song; error: DisTubeError }>;
  "queue.deleted": Readonly<BaseQueueEvent<Metadata, Target>>;
  /** The backend acknowledged a track; precedes any derived `queue.item.started`. */
  "voice.track.started": VoiceTrackEvent<Target>;
  "voice.track.finished": VoiceTrackEvent<Target>;
  "voice.track.failed": Readonly<BaseVoiceEvent<Target> & { itemId?: string; error: DisTubeError }>;
  /** A guild's voice presence ended; published once per DisTubeVoice, after that guild's `queue.deleted`. */
  "voice.disconnected": Readonly<
    BaseVoiceEvent<Target> & {
      channelId: string;
      reason: VoiceDisconnectReason;
      error?: DisTubeError;
    }
  >;
}

export type DisTubeEventName = keyof DisTubeEventMap;
export type DisTubeEventListener<Name extends DisTubeEventName, Metadata = unknown, Target = VoiceChannelTarget> = (
  event: DisTubeEventMap<Metadata, Target>[Name],
) => unknown;

type AnyListener = (event: never) => unknown;

const SAFE_DETAIL_FIELDS = [
  "event",
  "operation",
  "status",
  "code",
  "node",
  "reason",
  "guildId",
  "queueId",
  "slotGeneration",
  "delayMs",
  "positionMs",
  "resumed",
  "from",
  "to",
  "count",
  "attempt",
] as const;

/** Event callbacks run after producing commits, in FIFO order per guild. */
export class DisTubeEventEmitter<Target = VoiceChannelTarget> {
  readonly #listeners = new Map<DisTubeEventName, Set<AnyListener>>();
  readonly #diagnostic: (diagnostic: Diagnostic) => unknown;
  readonly #pending = new Map<string, (() => void)[]>();

  constructor(diagnostic: (diagnostic: Diagnostic) => unknown) {
    this.#diagnostic = diagnostic;
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name, unknown, Target>): () => void {
    const registration: AnyListener = event => listener(event as DisTubeEventMap<unknown, Target>[Name]);
    const listeners = this.#listeners.get(name) ?? new Set<AnyListener>();
    listeners.add(registration);
    this.#listeners.set(name, listeners);
    return () => {
      listeners.delete(registration);
      if (listeners.size === 0 && this.#listeners.get(name) === listeners) this.#listeners.delete(name);
    };
  }

  emit<Name extends DisTubeEventName>(name: Name, event: DisTubeEventMap<unknown, Target>[Name]): void {
    const deliver = (): void => {
      for (const listener of Array.from(this.#listeners.get(name) ?? [])) {
        try {
          void Promise.resolve(listener(event as never)).catch(error => this.#report(error, name));
        } catch (error: unknown) {
          this.#report(error, name);
        }
      }
    };
    const pending = this.#pending.get(event.guildId);
    if (pending) {
      pending.push(deliver);
      return;
    }
    const queue = [deliver];
    this.#pending.set(event.guildId, queue);
    queueMicrotask(() => {
      for (let index = 0; index < queue.length; index += 1) queue[index]?.();
      this.#pending.delete(event.guildId);
    });
  }

  report(diagnostic: Diagnostic): void {
    this.#deliver(diagnostic);
  }

  #report(error: unknown, event: DisTubeEventName): void {
    this.#deliver({
      severity: "error",
      stage: "event.listener",
      message: `Listener failed for ${event}`,
      error: asError(error),
      detail: Object.freeze({ event }),
    });
  }

  #deliver(diagnostic: Diagnostic): void {
    const record = safeDiagnostic(diagnostic);
    try {
      void Promise.resolve(this.#diagnostic(record)).catch(() => undefined);
    } catch {
      // Diagnostic consumers are terminal observers and cannot affect runtime work.
    }
  }
}

function safeDiagnostic(diagnostic: Diagnostic): Diagnostic {
  try {
    const detail = safeDiagnosticDetail(diagnostic.detail);
    return Object.freeze({
      severity: ["debug", "info", "warning", "error"].includes(diagnostic.severity) ? diagnostic.severity : "error",
      stage: sanitizeDiagnosticText(diagnostic.stage),
      message: sanitizeDiagnosticText(diagnostic.message),
      ...(typeof diagnostic.plugin === "string" ? { plugin: sanitizeDiagnosticText(diagnostic.plugin) } : {}),
      ...(diagnostic.error === undefined ? {} : { error: asError(diagnostic.error) }),
      ...(detail ? { detail } : {}),
    });
  } catch {
    return Object.freeze({
      severity: "error",
      stage: "diagnostic.invalid",
      message: "Diagnostic could not be read safely",
    });
  }
}

/** Keep bounded scalar context, not provider-owned native objects or credential fields. */
function safeDiagnosticDetail(detail: Diagnostic["detail"]): Diagnostic["detail"] {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return undefined;
  const safe: Record<string, string | number | boolean | null> = {};
  for (const key of SAFE_DETAIL_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(detail, key);
    if (!descriptor || !("value" in descriptor)) continue;
    const value: unknown = descriptor.value;
    if (typeof value === "string") safe[key] = sanitizeDiagnosticText(value);
    else if (typeof value === "boolean" || value === null) safe[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
  }
  return Object.keys(safe).length > 0 ? Object.freeze(safe) : undefined;
}
