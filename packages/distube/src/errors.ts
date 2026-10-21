export const ErrorCode = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  INVALID_STATE: "INVALID_STATE",
  ABORTED: "ABORTED",
  /** Every consulted plugin declined. */
  NO_RESULT: "NO_RESULT",
  NOT_FOUND: "NOT_FOUND",
  UNAVAILABLE: "UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  SOURCE_FAILED: "SOURCE_FAILED",
  VOICE_FAILED: "VOICE_FAILED",
  UNSUPPORTED: "UNSUPPORTED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface DisTubeErrorOptions extends ErrorOptions {
  /** The plugin the failure came from. */
  readonly source?: string;
}

export class DisTubeError<Code extends ErrorCode = ErrorCode> extends Error {
  readonly code: Code;
  readonly source?: string;

  constructor(code: Code, message: string, options?: DisTubeErrorOptions) {
    super(message, options);
    this.name = "DisTubeError";
    this.code = code;
    if (options?.source !== undefined) this.source = options.source;
  }

  /** Narrows `error` to a DisTubeError, carrying exactly `code` when given. */
  static is<Code extends ErrorCode = ErrorCode>(error: unknown, code?: Code): error is DisTubeError<Code> {
    return error instanceof DisTubeError && (code === undefined || error.code === code);
  }
}

export function toDisTubeError(code: ErrorCode, message: string, error: unknown, source?: string): DisTubeError {
  if (error instanceof DisTubeError) return error;
  return new DisTubeError(code, message, { cause: error, ...(source === undefined ? {} : { source }) });
}

export function abortError(signal: AbortSignal): DisTubeError {
  const cause: unknown = signal.reason;
  return new DisTubeError(ErrorCode.ABORTED, "Operation was cancelled", cause instanceof Error ? { cause } : undefined);
}

export function requireBoolean(value: unknown, name: string): void {
  if (typeof value !== "boolean") throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${name} must be a boolean`);
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}
