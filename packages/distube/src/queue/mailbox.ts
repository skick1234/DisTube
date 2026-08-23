export class Mailbox<Message> {
  readonly #handle: (message: Message) => void | Promise<void>;
  readonly #messages: Message[] = [];
  #draining = false;
  #closed = false;

  constructor(handle: (message: Message) => void | Promise<void>) {
    this.#handle = handle;
  }

  /** True once terminal work has taken ownership. A closed mailbox accepts no further messages. */
  get closed(): boolean {
    return this.#closed;
  }

  post(message: Message): void {
    // Terminal authority already committed. Late posts from detached effects are dropped here; their
    // callers learn the queue is gone from the active-state assertion on the command path.
    if (this.#closed) return;
    this.#messages.push(message);
    this.#start();
  }

  /**
   * Stops accepting new messages once terminal authority is committed.
   *
   * Already-queued messages still drain so each waiting caller settles: every handler re-checks
   * terminal state first and rejects. Discarding them here would strand their promises forever.
   */
  close(): void {
    this.#closed = true;
  }

  #start(): void {
    if (this.#draining) return;
    this.#draining = true;
    const first = this.#messages.shift();
    if (first === undefined) {
      this.#draining = false;
      return;
    }
    let result: void | Promise<void>;
    try {
      result = this.#handle(first);
    } catch (error: unknown) {
      // An idle post receives synchronous failures.
      this.#draining = false;
      throw error;
    }
    if (isPromise(result)) {
      void result.then(
        () => this.#drain(),
        () => this.#drain(),
      );
      return;
    }
    this.#drain();
  }

  #drain(): void {
    while (this.#messages.length > 0) {
      const next = this.#messages.shift();
      if (next === undefined) continue;
      let result: void | Promise<void>;
      try {
        result = this.#handle(next);
      } catch {
        // Once draining, command handlers own their rejection and the mailbox must remain usable.
        continue;
      }
      if (isPromise(result)) {
        void result.then(
          () => this.#drain(),
          () => this.#drain(),
        );
        return;
      }
    }
    this.#draining = false;
  }
}

function isPromise(value: unknown): value is Promise<void> {
  return typeof value === "object" && value !== null && "then" in value;
}
