import type { Diagnostic } from "./contracts";
import type { DisTubeError } from "./errors";
import type { QueueItem } from "./media";

export interface BaseQueueEvent {
  readonly queueId: string;
  readonly timestamp: number;
}

export interface QueueEventMap {
  "queue.created": Readonly<BaseQueueEvent>;
  "queue.item.added": Readonly<BaseQueueEvent & { item: QueueItem }>;
  "queue.item.started": Readonly<BaseQueueEvent & { item: QueueItem }>;
  "queue.item.finished": Readonly<BaseQueueEvent & { item: QueueItem }>;
  "queue.item.failed": Readonly<BaseQueueEvent & { item: QueueItem; error: DisTubeError }>;
  "queue.destroyed": Readonly<BaseQueueEvent>;
}

export type QueueEventName = keyof QueueEventMap;
export type QueueEventListener<Name extends QueueEventName> = (event: QueueEventMap[Name]) => unknown;

export class QueueEventEmitter {
  readonly #listeners = new Map<QueueEventName, Set<(event: never) => unknown>>();
  readonly #diagnostic: (diagnostic: Diagnostic) => unknown;

  constructor(diagnostic: (diagnostic: Diagnostic) => unknown) {
    this.#diagnostic = diagnostic;
  }

  on<Name extends QueueEventName>(name: Name, listener: QueueEventListener<Name>): this {
    const listeners = this.#listeners.get(name) ?? new Set();
    listeners.add(listener as (event: never) => unknown);
    this.#listeners.set(name, listeners);
    return this;
  }

  once<Name extends QueueEventName>(name: Name, listener: QueueEventListener<Name>): this {
    const wrapped = (event: QueueEventMap[Name]): unknown => {
      this.off(name, wrapped);
      return listener(event);
    };
    return this.on(name, wrapped);
  }

  off<Name extends QueueEventName>(name: Name, listener: QueueEventListener<Name>): this {
    this.#listeners.get(name)?.delete(listener as (event: never) => unknown);
    return this;
  }

  emit<Name extends QueueEventName>(name: Name, event: QueueEventMap[Name]): void {
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

  #report(error: unknown, event: QueueEventName): void {
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
