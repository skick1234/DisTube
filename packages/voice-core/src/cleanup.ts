export async function cleanupAll(operations: readonly (() => unknown)[]): Promise<void> {
  const failures: Error[] = [];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error: unknown) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Discord voice session cleanup failures");
}
