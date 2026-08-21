interface WorkSlot {
  readonly order: number;
  readonly result: Promise<unknown>;
}

/**
 * Tracks asynchronous work owned by one lifecycle object.
 *
 * Registration happens before the operation runs, so a terminal fence accepted in the same stack can
 * join it. Ordinary completed work is discarded until terminal settlement begins.
 */
export class TrackedWork {
  readonly #slots = new Map<number, WorkSlot>();
  #nextOrder = 0;
  #settling = false;
  #closed = false;
  #settlement?: Promise<readonly Error[]>;

  start<Value>(operation: () => Value | PromiseLike<Value>): Promise<Value> {
    if (this.#closed) {
      return Promise.reject(new Error("TrackedWork received work after terminal settlement"));
    }

    const order = this.#nextOrder++;
    let resolve!: (value: Value | PromiseLike<Value>) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<Value>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const slot: WorkSlot = { order, result };
    this.#slots.set(order, slot);

    // Keep rejected ordinary work observed even if its owner reports it separately.
    void result.catch(() => undefined);
    void result
      .finally(() => {
        if (!this.#settling) this.#slots.delete(order);
      })
      .catch(() => undefined);

    try {
      resolve(operation());
    } catch (error: unknown) {
      reject(error);
    }
    return result;
  }

  settle(): Promise<readonly Error[]> {
    this.#settlement ??= this.#settle();
    return this.#settlement;
  }

  async #settle(): Promise<readonly Error[]> {
    this.#settling = true;
    const failures: Error[] = [];
    let cursor = 0;

    while (true) {
      const batch = [...this.#slots.values()]
        .filter(slot => slot.order >= cursor)
        .sort((left, right) => left.order - right.order);
      if (batch.length === 0) {
        // A completion can schedule owned work in its final microtask. Let that registration land.
        await Promise.resolve();
        if (![...this.#slots.keys()].some(order => order >= cursor)) break;
        continue;
      }
      const last = batch.at(-1);
      if (last) cursor = last.order + 1;
      const results = await Promise.all(
        batch.map(async slot => {
          try {
            await slot.result;
            return undefined;
          } catch (error: unknown) {
            return asError(error);
          }
        }),
      );
      for (const failure of results) if (failure) failures.push(failure);
    }

    this.#slots.clear();
    this.#closed = true;
    return Object.freeze(failures);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
