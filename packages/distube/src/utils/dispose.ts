export async function settleAll(operations: readonly (() => void | Promise<void>)[]): Promise<readonly Error[]> {
  const failures: Error[] = [];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error: unknown) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return Object.freeze(failures);
}
