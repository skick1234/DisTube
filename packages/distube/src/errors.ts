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
  /** An established voice connection dropped beyond the Adapter's recovery. */
  VOICE_DISCONNECTED: "VOICE_DISCONNECTED",
  UNSUPPORTED: "UNSUPPORTED",
  /**
   * The media is age-restricted and was not added: the call did not set `allowAgeRestricted: true`, or the provider
   * refused it without an age-verified account.
   */
  AGE_RESTRICTED: "AGE_RESTRICTED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const CODES: ReadonlySet<unknown> = new Set(Object.values(ErrorCode));

/** What a failed provider lookup was for. A Spotify album or artist resolves to a Playlist, so it is `playlist`. */
export type ErrorMedia = "song" | "playlist";

export interface DisTubeErrorOptions extends ErrorOptions {
  /** The plugin the failure came from. */
  readonly source?: string;
  /** The text that found nothing: a query, a URL no plugin resolved, or the search the fallback ran. */
  readonly query?: string;
  readonly media?: ErrorMedia;
}

export class DisTubeError<Code extends ErrorCode = ErrorCode> extends Error {
  readonly code: Code;
  readonly source?: string;
  /** Set when every plugin was exhausted; see `DisTubeErrorOptions.query`. */
  readonly query?: string;
  /** Set by a plugin when the failure came from looking up one Song or one Playlist. */
  readonly media?: ErrorMedia;

  constructor(code: Code, message: string, options?: DisTubeErrorOptions) {
    super(message, options);
    this.name = "DisTubeError";
    this.code = code;
    if (options?.source !== undefined) this.source = options.source;
    if (options?.query !== undefined) this.query = options.query;
    if (options?.media !== undefined) this.media = options.media;
  }

  /**
   * Narrows `error` to a DisTubeError, carrying exactly `code` when given. Matches by `name` and `code` rather than
   * class identity, so an error from another installed copy of the package narrows too.
   */
  static is<Code extends ErrorCode = ErrorCode>(error: unknown, code?: Code): error is DisTubeError<Code> {
    if (!(error instanceof Error) || error.name !== "DisTubeError" || !("code" in error)) return false;
    return code === undefined ? CODES.has(error.code) : error.code === code;
  }
}

export function toDisTubeError(code: ErrorCode, message: string, error: unknown, source?: string): DisTubeError {
  if (DisTubeError.is(error)) return error;
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

export function requireInteger(value: number, name: string, min: number, max = Infinity): void {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${name} must be an integer from ${min} to ${max}`);
}

export function requireQuery(query: string): void {
  if (typeof query !== "string" || query.trim().length === 0)
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Query must be a non-empty string");
}
