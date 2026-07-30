export class Mailbox<Message> {
  readonly #handle: (message: Message) => void;
  readonly #messages: Message[] = [];
  #draining = false;

  constructor(handle: (message: Message) => void) {
    this.#handle = handle;
  }

  post(message: Message): void {
    this.#messages.push(message);
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#messages.length > 0) {
        const next = this.#messages.shift();
        if (next !== undefined) this.#handle(next);
      }
    } finally {
      this.#draining = false;
    }
  }
}
