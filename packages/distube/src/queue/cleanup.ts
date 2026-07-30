interface CleanupSlot {
  readonly order: number;
  readonly result: Promise<Error | undefined>;
}

/** @internal */
export class CleanupBarrier {
  readonly #slots: CleanupSlot[] = [];
  #nextOrder = 0;
  #settled = false;

  add(operation: () => void | Promise<void>): boolean {
    if (this.#settled) return false;
    const slot: CleanupSlot = {
      order: this.#nextOrder++,
      result: Promise.resolve()
        .then(operation)
        .then(
          () => undefined,
          (error: unknown) => asError(error),
        ),
    };
    this.#slots.push(slot);
    return true;
  }

  async settle(): Promise<readonly Error[]> {
    const failures: Error[] = [];
    let cursor = 0;
    while (cursor < this.#slots.length) {
      const batch = this.#slots.slice(cursor).sort((left, right) => left.order - right.order);
      cursor = this.#slots.length;
      for (const failure of await Promise.all(batch.map(slot => slot.result))) {
        if (failure) failures.push(failure);
      }
      await Promise.resolve();
    }
    this.#settled = true;
    return Object.freeze(failures);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
