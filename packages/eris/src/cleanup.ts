export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function collectCleanupFailures(operations: readonly (() => unknown)[]): Error[] {
  const failures: Error[] = [];
  for (const operation of operations) {
    try {
      operation();
    } catch (error: unknown) {
      failures.push(asError(error));
    }
  }
  return failures;
}

export function throwCleanupFailures(failures: readonly Error[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Eris Player cleanup failures");
}
