import { asError } from "../errors";

interface WorkSlot {
  readonly order: number;
  readonly result: Promise<unknown>;
}

/**
 * Settles a collection that can still grow while it is being drained.
 *
 * `nextBatch` returns the promises registered since the previous call and advances the caller's cursor.
 * `hasPending` lets a caller whose owned work can register in its own final microtask retry once before
 * concluding the collection is drained. Every batch settles concurrently; failures keep registration order.
 */
export async function settleGrowing(
  nextBatch: () => readonly Promise<unknown>[],
  hasPending?: () => boolean,
): Promise<Error[]> {
  const failures: Error[] = [];
  while (true) {
    const batch = nextBatch();
    if (batch.length === 0) {
      if (!hasPending) break;
      // A completion can schedule owned work in its final microtask. Let that registration land.
      await Promise.resolve();
      if (!hasPending()) break;
      continue;
    }
    const settled = await Promise.all(
      batch.map(async result => {
        try {
          await result;
          return undefined;
        } catch (error: unknown) {
          return asError(error);
        }
      }),
    );
    for (const failure of settled) if (failure) failures.push(failure);
  }
  return failures;
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
    let cursor = 0;
    const failures = await settleGrowing(
      () => {
        const batch = [...this.#slots.values()]
          .filter(slot => slot.order >= cursor)
          .sort((left, right) => left.order - right.order);
        const last = batch.at(-1);
        if (last) cursor = last.order + 1;
        return batch.map(slot => slot.result);
      },
      () => [...this.#slots.keys()].some(order => order >= cursor),
    );

    this.#slots.clear();
    this.#closed = true;
    return Object.freeze(failures);
  }
}
