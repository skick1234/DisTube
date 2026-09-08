import type { Diagnostic } from "./contracts";
import type { DisTubeGuild, GuildState } from "./DisTubeGuild";
import { asError, type DisTubeError } from "./errors";
import type { Playlist, QueueItem, Song } from "./media";
import type { DisTubeVoice } from "./voice/DisTubeVoice";

export interface BaseQueueEvent<Metadata = unknown> {
  readonly guildId: string;
  /** The queue the transition committed on; its commands reject once it is deleted. */
  readonly queue: DisTubeGuild<Metadata>;
  readonly state: GuildState<Metadata>;
  /** When the committing transition ran, not when the listener is called. */
  readonly timestamp: number;
}

/** Why a guild's DisTubeVoice ended: the application left, the platform dropped it, or the client shut down. */
export type VoiceDisconnectReason = "left" | "platform" | "shutdown";

export interface DisTubeEventMap<Metadata = unknown> {
  "queue.created": Readonly<BaseQueueEvent<Metadata>>;
  "queue.item.added": Readonly<BaseQueueEvent<Metadata> & { item: QueueItem<Metadata> }>;
  /** One resolved Playlist committed as a collection; its items publish no per-item events. */
  "queue.playlist.added": Readonly<
    BaseQueueEvent<Metadata> & { playlist: Playlist; items: readonly QueueItem<Metadata>[] }
  >;
  "queue.item.started": Readonly<BaseQueueEvent<Metadata> & { item: QueueItem<Metadata> }>;
  "queue.item.finished": Readonly<BaseQueueEvent<Metadata> & { item: QueueItem<Metadata> }>;
  "queue.item.failed": Readonly<BaseQueueEvent<Metadata> & { item: QueueItem<Metadata>; error: DisTubeError }>;
  /** Playback ran out of successors; the queue deletes itself next. */
  "queue.finished": Readonly<BaseQueueEvent<Metadata>>;
  /** The reference Song had no autoplay continuation, so the queue proceeds to exhaustion. */
  "queue.autoplay.failed": Readonly<BaseQueueEvent<Metadata> & { song: Song; error: DisTubeError }>;
  "queue.deleted": Readonly<BaseQueueEvent<Metadata>>;
  /** A guild's voice presence ended; published once per DisTubeVoice, after that guild's `queue.deleted`. */
  "voice.disconnected": Readonly<{
    guildId: string;
    voice: DisTubeVoice;
    channelId: string;
    timestamp: number;
    reason: VoiceDisconnectReason;
    error?: DisTubeError;
  }>;
}

export type DisTubeEventName = keyof DisTubeEventMap;
export type DisTubeEventListener<Name extends DisTubeEventName, Metadata = unknown> = (
  event: DisTubeEventMap<Metadata>[Name],
) => unknown;

type AnyListener = (event: never) => unknown;

/** Event callbacks run after producing commits, in FIFO order per guild. */
export class DisTubeEventEmitter {
  readonly #listeners = new Map<DisTubeEventName, Set<AnyListener>>();
  readonly #diagnostic: (diagnostic: Diagnostic) => unknown;
  readonly #pending = new Map<string, (() => void)[]>();

  constructor(diagnostic: (diagnostic: Diagnostic) => unknown) {
    this.#diagnostic = diagnostic;
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): () => void {
    const registration: AnyListener = event => listener(event as DisTubeEventMap[Name]);
    const listeners = this.#listeners.get(name) ?? new Set<AnyListener>();
    listeners.add(registration);
    this.#listeners.set(name, listeners);
    return () => {
      listeners.delete(registration);
      if (listeners.size === 0 && this.#listeners.get(name) === listeners) this.#listeners.delete(name);
    };
  }

  emit<Name extends DisTubeEventName>(name: Name, event: DisTubeEventMap[Name]): void {
    const deliver = (): void => {
      for (const listener of [...(this.#listeners.get(name) ?? [])]) {
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
    const record = Object.freeze({ ...diagnostic });
    try {
      void Promise.resolve(this.#diagnostic(record)).catch(() => undefined);
    } catch {
      // Diagnostic consumers are terminal observers and cannot affect runtime work.
    }
  }
}
