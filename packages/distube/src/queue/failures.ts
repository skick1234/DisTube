import { asError, DisTubeError, type ErrorCode } from "../errors";

export { asError };

export function cleanupFailure(
  code: ErrorCode,
  message: string,
  failures: readonly Error[],
  aggregateMessage: string,
): DisTubeError | undefined {
  if (failures.length === 0) return undefined;
  return new DisTubeError(code, message, {
    cause: failures.length === 1 ? failures[0] : new AggregateError(failures, aggregateMessage),
  });
}
