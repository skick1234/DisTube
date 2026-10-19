import { asError } from "../errors";

export async function settleAll(operations: readonly (() => void | Promise<void>)[]): Promise<readonly Error[]> {
  const failures: Error[] = [];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error: unknown) {
      failures.push(asError(error));
    }
  }
  return Object.freeze(failures);
}

export interface DisposeOnce {
  readonly dispose: () => Promise<void>;
}

export function disposeOnce(operation: () => void | Promise<void>): DisposeOnce {
  let result: Promise<void> | undefined;
  return Object.freeze({
    dispose: (): Promise<void> => {
      result ??= Promise.resolve().then(operation);
      return result;
    },
  });
}
