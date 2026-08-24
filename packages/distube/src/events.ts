import type { Diagnostic } from "./contracts";
import type { DisTubeError } from "./errors";
import type { GuildQueue } from "./GuildQueue";
import type { Playlist, QueueItem, Song } from "./media";

export interface BaseQueueEvent<Metadata = unknown> {
  readonly guildId: string;
  /** The queue the transition committed on; its commands reject once it is deleted. */
  readonly queue: GuildQueue<Metadata>;
  /** When the committing transition ran, not when the listener is called. */
  readonly timestamp: number;
}

/** Why a guild's Voice ended: the application left, the platform dropped it, or the client shut down. */
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
  /** A guild's voice presence ended; published once per Voice, after that guild's `queue.deleted`. */
  "voice.disconnected": Readonly<{
    guildId: string;
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

/**
 * One registration: what the caller handed in, and what actually runs.
 *
 * They differ for `once`, which runs a self-removing wrapper. Keeping both means `off` can be given the
 * caller's own function and still find a `once` registration, which a set of wrappers alone cannot do.
 */
interface Registration {
  readonly listener: AnyListener;
  readonly invoke: AnyListener;
}

/** @internal */
export class DisTubeEventEmitter {
  readonly #listeners = new Map<DisTubeEventName, Registration[]>();
  readonly #diagnostic: (diagnostic: Diagnostic) => unknown;

  constructor(diagnostic: (diagnostic: Diagnostic) => unknown) {
    this.#diagnostic = diagnostic;
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): this {
    const wrapped = listener as AnyListener;
    return this.#register(name, { listener: wrapped, invoke: wrapped });
  }

  once<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): this {
    // The registration removes itself by identity, so a second registration of the same function survives.
    const registration: Registration = {
      listener: listener as AnyListener,
      invoke: (event: never): unknown => {
        this.#remove(name, entry => entry === registration);
        return listener(event as DisTubeEventMap[Name]);
      },
    };
    return this.#register(name, registration);
  }

  /** Removes one registration of `listener`, whether it was added with `on` or with `once`. */
  off<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): this {
    this.#remove(name, entry => entry.listener === (listener as AnyListener));
    return this;
  }

  /** Drops every listener for `name`, or for every event when `name` is omitted. */
  removeAllListeners(name?: DisTubeEventName): this {
    if (name === undefined) this.#listeners.clear();
    else this.#listeners.delete(name);
    return this;
  }

  emit<Name extends DisTubeEventName>(name: Name, event: DisTubeEventMap[Name]): void {
    // Delivery works from the list as it stood on entry: a listener that registers or removes one
    // must not change who receives this event.
    for (const { invoke } of [...(this.#listeners.get(name) ?? [])]) {
      try {
        Promise.resolve(invoke(event as never)).catch(error => this.#report(error, name));
      } catch (error: unknown) {
        this.#report(error, name);
      }
    }
  }

  #register(name: DisTubeEventName, registration: Registration): this {
    const registrations = this.#listeners.get(name) ?? [];
    registrations.push(registration);
    this.#listeners.set(name, registrations);
    return this;
  }

  #remove(name: DisTubeEventName, matches: (registration: Registration) => boolean): void {
    const registrations = this.#listeners.get(name);
    if (!registrations) return;
    const index = registrations.findIndex(matches);
    if (index < 0) return;
    registrations.splice(index, 1);
    if (registrations.length === 0) this.#listeners.delete(name);
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
