/**
 * Reports the collected Eris teardown failures: one as itself, several as one aggregate naming
 * this package's cleanup.
 */
export function throwCleanupFailures(failures: readonly Error[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Eris Player cleanup failures");
}
