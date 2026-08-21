export class Mailbox<Message> {
  readonly #handle: (message: Message) => void | Promise<void>;
  readonly #messages: Message[] = [];
  #draining = false;

  constructor(handle: (message: Message) => void | Promise<void>) {
    this.#handle = handle;
  }

  post(message: Message): void {
    this.#messages.push(message);
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
        // An idle post receives synchronous failures. Once draining, command handlers own their
        // rejection and the mailbox must remain usable.
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
