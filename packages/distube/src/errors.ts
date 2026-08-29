import { ErrorReason } from "./enums";

export enum ErrorCode {
  INVALID_ARGUMENT = "INVALID_ARGUMENT",
  SOURCE_FAILED = "SOURCE_FAILED",
  VOICE_FAILED = "VOICE_FAILED",
  PLUGIN_FAILED = "PLUGIN_FAILED",
  QUEUE_FAILED = "QUEUE_FAILED",
  UNSUPPORTED = "UNSUPPORTED",
}

/** The five codes that report a subsystem failure rather than a rejected call. */
export type FailureCode = Exclude<ErrorCode, ErrorCode.INVALID_ARGUMENT>;

export class DisTubeError extends Error {
  readonly code: ErrorCode;
  /** Present exactly when `code` is `INVALID_ARGUMENT`, and `undefined` for every other code. */
  readonly reason: ErrorReason | undefined;

  /** A rejected call names why it was rejected; the compiler will not let it be omitted. */
  constructor(code: ErrorCode.INVALID_ARGUMENT, reason: ErrorReason, message: string, options?: ErrorOptions);
  constructor(code: FailureCode, message: string, options?: ErrorOptions);
  constructor(
    code: ErrorCode,
    reasonOrMessage: ErrorReason | string,
    messageOrOptions?: string | ErrorOptions,
    options?: ErrorOptions,
  ) {
    const rejected = code === ErrorCode.INVALID_ARGUMENT;
    super(
      rejected ? (messageOrOptions as string) : (reasonOrMessage as string),
      rejected ? options : (messageOrOptions as ErrorOptions | undefined),
    );
    this.name = "DisTubeError";
    this.code = code;
    this.reason = rejected ? (reasonOrMessage as ErrorReason) : undefined;
  }
}

/**
 * One error for a shape check whose code the caller chooses at runtime.
 *
 * Every such check rejects a malformed value, so an `INVALID_ARGUMENT` from here is always `Argument`;
 * a caller that passes a failure code is attributing the same malformed value to a subsystem instead.
 */
export function malformedValue(code: ErrorCode, message: string): DisTubeError {
  return code === ErrorCode.INVALID_ARGUMENT
    ? new DisTubeError(code, ErrorReason.Argument, message)
    : new DisTubeError(code, message);
}

/**
 * The one public rejection a cancelled operation produces.
 *
 * A platform `DOMException`, an `AbortError`, or a plain string reason is never the thrown value: callers
 * get a fresh `QUEUE_FAILED` error and read an Error reason through `cause`, which is absent when the reason is not
 * an Error. A caller-provided DisTubeError is a cause too, never the rejection itself.
 */
export function abortFailure(reason: unknown): DisTubeError {
  return new DisTubeError(
    ErrorCode.QUEUE_FAILED,
    "Queue operation was cancelled",
    reason instanceof Error ? { cause: reason } : undefined,
  );
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The subsystem's own error for an underlying failure, wrapping only when the code has to change.
 *
 * A replaced code never carries the wrapped error's `reason` forward: the new code owns the failure, and
 * only `INVALID_ARGUMENT` may carry a reason at all.
 */
export function asDisTubeError(code: FailureCode, message: string, error: unknown): DisTubeError {
  if (error instanceof DisTubeError && error.code === code) return error;
  return new DisTubeError(code, message, { cause: asError(error) });
}
