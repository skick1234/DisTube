import type { EnqueueCompletion, EnqueueOperation, EnqueueOptions } from "./protocol";

export class EnqueueCoordinator {
  readonly #operations = new Map<number, EnqueueOperation>();
  readonly #completions = new Map<number, EnqueueCompletion>();
  #nextSequence = 0;
  #nextCommit = 0;

  create(
    options: EnqueueOptions,
    resolve: EnqueueOperation["resolve"],
    reject: EnqueueOperation["reject"],
  ): EnqueueOperation {
    const controller = new AbortController();
    return {
      sequence: this.#nextSequence++,
      controller,
      // Either side may cancel: the queue aborts on terminal work, the caller aborts on their own signal.
      signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
      options,
      resolve,
      reject,
    };
  }

  accept(operation: EnqueueOperation): void {
    this.#operations.set(operation.sequence, operation);
  }

  complete(completion: EnqueueCompletion): readonly EnqueueCompletion[] {
    const operation = this.#operations.get(completion.operation.sequence);
    if (operation !== completion.operation) return [];
    this.#completions.set(operation.sequence, completion);

    const ready: EnqueueCompletion[] = [];
    while (true) {
      const next = this.#completions.get(this.#nextCommit);
      if (!next) break;
      this.#nextCommit += 1;
      ready.push(next);
    }
    return ready;
  }

  commit(completion: EnqueueCompletion): void {
    const { operation } = completion;
    if (this.#operations.get(operation.sequence) !== operation) return;
    this.#completions.delete(operation.sequence);
    this.#operations.delete(operation.sequence);
  }

  cancel(error: () => Error): void {
    for (const operation of this.#operations.values()) {
      operation.controller.abort(error());
      operation.reject(error());
    }
    this.#operations.clear();
    this.#completions.clear();
    this.#nextCommit = this.#nextSequence;
  }
}
