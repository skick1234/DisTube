export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Runs every synchronous teardown step, collecting failures instead of stopping at the first. */
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

export async function cleanupAll(operations: readonly (() => unknown)[]): Promise<void> {
  const failures: Error[] = [];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error: unknown) {
      failures.push(asError(error));
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Discord voice session cleanup failures");
}
