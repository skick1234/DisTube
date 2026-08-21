import type { Diagnostic } from "./contracts";
import type { DisTubeError } from "./errors";
import type { GuildQueue } from "./GuildQueue";
import type { Playlist, QueueItem, Song } from "./media";

export interface BaseQueueEvent {
  readonly guildId: string;
  /** The queue the transition committed on; its commands reject once it is deleted. */
  readonly queue: GuildQueue;
  /** When the committing transition ran, not when the listener is called. */
  readonly timestamp: number;
}

/** Why a guild's Voice ended: the application left, the platform dropped it, or the client shut down. */
export type VoiceDisconnectReason = "left" | "platform" | "shutdown";

export interface DisTubeEventMap {
  "queue.created": Readonly<BaseQueueEvent>;
  "queue.item.added": Readonly<BaseQueueEvent & { item: QueueItem }>;
  /** One resolved Playlist committed as a collection; its items publish no per-item events. */
  "queue.playlist.added": Readonly<BaseQueueEvent & { playlist: Playlist; items: readonly QueueItem[] }>;
  "queue.item.started": Readonly<BaseQueueEvent & { item: QueueItem }>;
  "queue.item.finished": Readonly<BaseQueueEvent & { item: QueueItem }>;
  "queue.item.failed": Readonly<BaseQueueEvent & { item: QueueItem; error: DisTubeError }>;
  /** Playback ran out of successors; the queue deletes itself next. */
  "queue.finished": Readonly<BaseQueueEvent>;
  /** The reference Song had no autoplay continuation, so the queue proceeds to exhaustion. */
  "queue.autoplay.failed": Readonly<BaseQueueEvent & { song: Song; error: DisTubeError }>;
  "queue.deleted": Readonly<BaseQueueEvent>;
  /** A guild's voice presence ended; published once per Voice, after that guild's `queue.deleted`. */
  "voice.disconnected": Readonly<{
    guildId: string;
    timestamp: number;
    reason: VoiceDisconnectReason;
    error?: DisTubeError;
  }>;
}

export type DisTubeEventName = keyof DisTubeEventMap;
export type DisTubeEventListener<Name extends DisTubeEventName> = (event: DisTubeEventMap[Name]) => unknown;

/** @internal */
export class DisTubeEventEmitter {
  readonly #listeners = new Map<DisTubeEventName, Set<(event: never) => unknown>>();
  readonly #diagnostic: (diagnostic: Diagnostic) => unknown;

  constructor(diagnostic: (diagnostic: Diagnostic) => unknown) {
    this.#diagnostic = diagnostic;
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): this {
    const listeners = this.#listeners.get(name) ?? new Set();
    listeners.add(listener as (event: never) => unknown);
    this.#listeners.set(name, listeners);
    return this;
  }

  once<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): this {
    const wrapped = (event: DisTubeEventMap[Name]): unknown => {
      this.off(name, wrapped);
      return listener(event);
    };
    return this.on(name, wrapped);
  }

  off<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): this {
    this.#listeners.get(name)?.delete(listener as (event: never) => unknown);
    return this;
  }

  emit<Name extends DisTubeEventName>(name: Name, event: DisTubeEventMap[Name]): void {
    for (const listener of this.#listeners.get(name) ?? []) {
      try {
        Promise.resolve(listener(event as never)).catch(error => this.#report(error, name));
      } catch (error: unknown) {
        this.#report(error, name);
      }
    }
  }

  report(diagnostic: Diagnostic): void {
    this.#deliver(diagnostic);
  }

  #report(error: unknown, event: DisTubeEventName): void {
    this.#deliver({
      severity: "error",
      stage: "event.listener",
      message: `Listener failed for ${event}`,
      error: error instanceof Error ? error : new Error(String(error)),
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
