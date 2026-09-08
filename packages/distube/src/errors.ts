/** Internal spelling table; the root exports only the literal ErrorCode type. */
export const ErrorCode = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  INVALID_STATE: "INVALID_STATE",
  ABORTED: "ABORTED",
  SOURCE_FAILED: "SOURCE_FAILED",
  VOICE_FAILED: "VOICE_FAILED",
  PLUGIN_FAILED: "PLUGIN_FAILED",
  QUEUE_FAILED: "QUEUE_FAILED",
  UNSUPPORTED: "UNSUPPORTED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
export type FailureCode = Exclude<ErrorCode, "INVALID_ARGUMENT" | "INVALID_STATE" | "ABORTED">;

export class DisTubeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DisTubeError";
    this.code = code;
  }
}

export function malformedValue(code: ErrorCode, message: string): DisTubeError {
  return new DisTubeError(code, message);
}

/** Caller cancellation keeps Error reasons, without reflecting arbitrary caller data. */
export function abortFailure(reason: unknown): DisTubeError {
  return new DisTubeError(
    "ABORTED",
    "Operation was cancelled",
    reason instanceof Error ? { cause: reason } : undefined,
  );
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Operation failed with a non-Error value");
}

/** Preserve a matching boundary error; reclassification retains the original failure once. */
export function asDisTubeError(code: FailureCode, message: string, error: unknown): DisTubeError {
  if (error instanceof DisTubeError && error.code === code) return error;
  return new DisTubeError(code, message, { cause: asError(error) });
}
