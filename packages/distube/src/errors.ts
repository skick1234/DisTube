/** Core error codes. Plugins add their own upper-case prefixed codes, so `code` stays a string. */
export const ErrorCode = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  INVALID_STATE: "INVALID_STATE",
  ABORTED: "ABORTED",
  SOURCE_FAILED: "SOURCE_FAILED",
  VOICE_FAILED: "VOICE_FAILED",
  PLUGIN_FAILED: "PLUGIN_FAILED",
  QUEUE_FAILED: "QUEUE_FAILED",
  UNSUPPORTED: "UNSUPPORTED",
  /** Every consulted source declined the query. */
  NO_RESULT: "NO_RESULT",
} as const;

export type CoreErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
/** The core literals plus any plugin-owned code, which keeps a `switch` with a default branch exhaustive. */
export type ErrorCode = CoreErrorCode | (string & {});
export type FailureCode = Exclude<CoreErrorCode, "INVALID_ARGUMENT" | "INVALID_STATE" | "ABORTED" | "NO_RESULT">;

const MAX_ERROR_DEPTH = 6;
const MAX_AGGREGATE_ERRORS = 16;
const MAX_ERROR_TEXT = 512;
const MAX_ERROR_NODES = 64;
const REDACTED = "[REDACTED]";

export interface ErrorContext {
  /** Exact resource, header and path values that must not cross this boundary. */
  readonly sensitiveValues?: readonly string[];
  /** Replace a safe DisTubeError carrying a different code. */
  readonly reclassify?: boolean;
}

export class DisTubeError<Code extends string = string> extends Error {
  readonly code: Code;

  constructor(code: Code, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DisTubeError";
    this.code = code;
  }

  /** Narrows `error` to the DisTubeError carrying exactly `code`. */
  static is<Code extends string>(error: unknown, code: Code): error is DisTubeError<Code> {
    return error instanceof DisTubeError && error.code === code;
  }
}

export function malformedValue(code: ErrorCode, message: string): DisTubeError {
  return new DisTubeError(code, message);
}

/** Caller cancellation keeps Error reasons, without reflecting arbitrary caller data. */
export function abortFailure(reason: unknown, context?: ErrorContext): DisTubeError {
  return new DisTubeError(
    ErrorCode.ABORTED,
    "Operation was cancelled",
    isError(reason) ? { cause: asError(reason, context) } : undefined,
  );
}

/** Return an already-safe Error unchanged, or copy its public causal graph into a bounded safe form. */
export function asError(error: unknown, context?: ErrorContext): Error {
  if (!isError(error)) return new Error("Operation failed with a non-Error value");
  const redactions = redactionValues(context);
  return isSafeError(error, redactions, 0, new Set(), { remaining: MAX_ERROR_NODES })
    ? error
    : sanitizeError(error, redactions, 0, new Set(), { remaining: MAX_ERROR_NODES });
}

/** Preserve safe plugin errors unless the accepting boundary requires its own classification. */
export function asDisTubeError(
  code: FailureCode,
  message: string,
  error: unknown,
  context?: ErrorContext,
): DisTubeError {
  const safe = asError(error, context);
  if (safe instanceof DisTubeError && (!context?.reclassify || safe.code === code)) {
    return safe;
  }
  return new DisTubeError(code, sanitizeText(message, redactionValues(context)), { cause: safe });
}

function isError(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function redactionValues(context: ErrorContext | undefined): readonly string[] {
  return [...new Set(context?.sensitiveValues?.filter(value => value.length > 0) ?? [])].sort(
    (left, right) => right.length - left.length,
  );
}

function sanitizeText(value: string, redactions: readonly string[], limit = MAX_ERROR_TEXT): string {
  let safe = value;
  for (const secret of redactions) safe = safe.replaceAll(secret, REDACTED);
  safe = safe
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, `$1${REDACTED}@`)
    .replace(/([?&](?:access_token|api_key|auth|key|sig|signature|token)=)[^&#\s]*/giu, `$1${REDACTED}`)
    .replace(
      /\b(authorization|cookie|proxy-authorization|set-cookie|x-api-key)\s*[:=]\s*[^\r\n,;]*/giu,
      `$1: ${REDACTED}`,
    );
  return safe.length <= limit ? safe : `${safe.slice(0, limit - 1)}…`;
}

/** @internal Sanitize diagnostic text with the same redaction and size bound as error messages. */
export function sanitizeDiagnosticText(value: unknown): string {
  return typeof value === "string" ? sanitizeText(value, []) : "Invalid diagnostic text";
}

function isSafeText(value: string, redactions: readonly string[]): boolean {
  return value === sanitizeText(value, redactions);
}

function isSafeError(
  error: Error,
  redactions: readonly string[],
  depth: number,
  active: ReadonlySet<Error>,
  budget: { remaining: number },
): boolean {
  if (depth > MAX_ERROR_DEPTH || active.has(error) || budget.remaining-- <= 0) return false;
  try {
    if (!hasSafeErrorPrototype(error)) return false;
    const allowed =
      error instanceof AggregateError
        ? new Set(["stack", "message", "name", "cause", "errors"])
        : error instanceof DisTubeError
          ? new Set(["stack", "message", "name", "cause", "code"])
          : new Set(["stack", "message", "name", "cause"]);
    if (Reflect.ownKeys(error).some(key => typeof key !== "string" || !allowed.has(key))) return false;
    if (
      Object.entries(Object.getOwnPropertyDescriptors(error)).some(
        ([key, descriptor]) => !("value" in descriptor) && (key !== "stack" || !isNativeStackAccessor(descriptor)),
      )
    )
      return false;
    if (error.stack !== undefined && error.stack !== sanitizeText(error.stack, redactions, 8192)) return false;
    if (!isSafeText(error.name, redactions) || !isSafeText(error.message, redactions)) return false;
    if (error instanceof DisTubeError && !isSafeText(error.code, redactions)) return false;

    const next = new Set(active).add(error);
    const cause = ownValue(error, "cause");
    if (cause !== undefined && (!isError(cause) || !isSafeError(cause, redactions, depth + 1, next, budget)))
      return false;
    if (!(error instanceof AggregateError)) return true;

    const errors = ownValue(error, "errors");
    if (!Array.isArray(errors) || errors.length > MAX_AGGREGATE_ERRORS) return false;
    const keys = Reflect.ownKeys(errors);
    if (keys.length !== errors.length + 1 || keys[errors.length] !== "length") return false;
    for (let index = 0; index < errors.length; index += 1) {
      if (keys[index] !== String(index)) return false;
      const member = Object.getOwnPropertyDescriptor(errors, String(index));
      if (!member || !("value" in member) || !isError(member.value)) return false;
      if (!isSafeError(member.value, redactions, depth + 1, next, budget)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isNativeStackAccessor(descriptor: PropertyDescriptor): boolean {
  return (
    typeof descriptor.get === "function" &&
    typeof descriptor.set === "function" &&
    Function.prototype.toString.call(descriptor.get).includes("[native code]") &&
    Function.prototype.toString.call(descriptor.set).includes("[native code]")
  );
}

function hasSafeErrorPrototype(error: Error): boolean {
  let prototype = Object.getPrototypeOf(error);
  for (let depth = 0; prototype && depth < MAX_ERROR_DEPTH; depth += 1) {
    const keys = Reflect.ownKeys(prototype);
    const builtin = keys.includes("name") && keys.includes("message");
    if (
      keys.some(key => key !== "constructor" && !(builtin && ["name", "message", "toString"].includes(key as string)))
    )
      return false;
    if (builtin) {
      return ["name", "message", "toString"].every(key => {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
        return !descriptor || "value" in descriptor;
      });
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

function sanitizeError(
  error: Error,
  redactions: readonly string[],
  depth: number,
  active: ReadonlySet<Error>,
  budget: { remaining: number },
): Error {
  if (depth > MAX_ERROR_DEPTH || budget.remaining-- <= 0) return new Error("Further error causes omitted");
  if (active.has(error)) return new Error("Circular error cause omitted");

  const next = new Set(active).add(error);
  try {
    const message = sanitizeText(error.message, redactions);
    const cause = sanitizeCause(ownValue(error, "cause"), redactions, depth + 1, next, budget);
    if (error instanceof DisTubeError) {
      const copy = new DisTubeError(sanitizeText(error.code, redactions), message, cause ? { cause } : undefined);
      copy.name = sanitizeText(error.name, redactions);
      copy.stack = safeStack(error, redactions);
      return copy;
    }
    if (error instanceof AggregateError) {
      const values = ownValue(error, "errors");
      const members = sanitizeAggregateMembers(values, redactions, depth + 1, next, budget);
      const copy = new AggregateError(members, message, cause ? { cause } : undefined);
      copy.name = sanitizeText(error.name, redactions);
      copy.stack = safeStack(error, redactions);
      return copy;
    }
    const copy = new Error(message, cause ? { cause } : undefined);
    copy.name = sanitizeText(error.name, redactions);
    copy.stack = safeStack(error, redactions);
    return copy;
  } catch {
    return new Error("Error details could not be read safely");
  }
}

function safeStack(error: Error, redactions: readonly string[]): string | undefined {
  try {
    const stack = error.stack;
    return typeof stack === "string" ? sanitizeText(stack, redactions, 8192) : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeAggregateMembers(
  values: unknown,
  redactions: readonly string[],
  depth: number,
  active: ReadonlySet<Error>,
  budget: { remaining: number },
): Error[] {
  if (!Array.isArray(values)) return [new Error("Malformed aggregate errors omitted")];
  const members: Error[] = [];
  for (let index = 0; index < Math.min(values.length, MAX_AGGREGATE_ERRORS); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    members.push(
      descriptor && "value" in descriptor
        ? sanitizeUnknown(descriptor.value, redactions, depth, active, budget)
        : new Error("Malformed aggregate member omitted"),
    );
  }
  if (values.length > MAX_AGGREGATE_ERRORS) {
    members.push(new Error(`${values.length - MAX_AGGREGATE_ERRORS} further aggregate errors omitted`));
  }
  return members;
}

function sanitizeCause(
  cause: unknown,
  redactions: readonly string[],
  depth: number,
  active: ReadonlySet<Error>,
  budget: { remaining: number },
): Error | undefined {
  return cause === undefined ? undefined : sanitizeUnknown(cause, redactions, depth, active, budget);
}

function sanitizeUnknown(
  value: unknown,
  redactions: readonly string[],
  depth: number,
  active: ReadonlySet<Error>,
  budget: { remaining: number },
): Error {
  return isError(value)
    ? sanitizeError(value, redactions, depth, active, budget)
    : new Error("Operation failed with a non-Error value");
}

function ownValue(value: Error, key: "cause" | "errors"): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new Error("Error graph contains an accessor");
  return descriptor.value;
}
