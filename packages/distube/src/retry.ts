import type { PluginReport } from "./contracts";
import { DisTubeError } from "./errors";

const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 500, 502, 503, 504]);
const CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
]);
const MAX_WAITS_MS = [250, 1000];
const CANCELLED = new Set(["TimeoutError", "AbortError"]);

export interface RetryOptions {
  readonly signal: AbortSignal;
  /** The plugin name; the diagnostic stage is `<name>.request.retried`. */
  readonly name: string;
  readonly host: string;
  readonly report: PluginReport;
  /** Decides whether a thrown error is worth another try, in place of the status and connection check. */
  readonly transient?: (error: unknown) => boolean;
}

function* chain(value: unknown): Generator<object> {
  const seen = new Set<unknown>();
  for (let link = value; typeof link === "object" && link !== null && !seen.has(link);) {
    seen.add(link);
    yield link;
    link = "cause" in link ? link.cause : undefined;
  }
}

function statusOf(value: unknown): number | undefined {
  return typeof value === "object" && value !== null && "status" in value && typeof value.status === "number"
    ? value.status
    : undefined;
}

function codeOf(value: object): string | undefined {
  return "code" in value && typeof value.code === "string" ? value.code : undefined;
}

function cancelled(error: unknown): boolean {
  return [...chain(error)].some(link => "name" in link && typeof link.name === "string" && CANCELLED.has(link.name));
}

function failedRequest(value: unknown): boolean {
  const status = statusOf(value);
  if (status !== undefined) return TRANSIENT_STATUSES.has(status);
  return [...chain(value)].some(link => CONNECTION_CODES.has(codeOf(link) ?? ""));
}

const thrownRequest = (error: unknown): boolean => !DisTubeError.is(error) && failedRequest(error);

function describe(error: unknown): string {
  for (const link of chain(error)) {
    const code = codeOf(link);
    if (code !== undefined) return code;
  }
  return error instanceof Error ? error.name : typeof error;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Calls `send` up to 3 times, trying again after a 500, 502, 503, 504 or 408 answer or a connection failure before an
 * answer, never after an abort or a timeout. Waits up to 250 ms, then up to 1 s, at random, and reports each retry as
 * `<name>.request.retried`. Resolves with the last answer or rejects with the last error, unchanged.
 */
export async function retryRequest<Answer>(send: () => Promise<Answer>, options: RetryOptions): Promise<Answer> {
  const { signal, name, host, report, transient = thrownRequest } = options;
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted();
    const last = attempt > MAX_WAITS_MS.length;
    let failure: { readonly status: number } | { readonly error: string };
    try {
      const answer = await send();
      const status = statusOf(answer);
      if (last || signal.aborted || status === undefined || !TRANSIENT_STATUSES.has(status)) return answer;
      if (answer instanceof Response) answer.body?.cancel().catch(() => undefined);
      failure = { status };
    } catch (error: unknown) {
      if (last || signal.aborted || cancelled(error) || !transient(error)) throw error;
      const status = statusOf(error);
      failure = status === undefined ? { error: describe(error) } : { status };
    }
    const reason = "status" in failure ? `HTTP ${failure.status}` : failure.error;
    report({
      severity: "info",
      stage: `${name}.request.retried`,
      message: `Retrying a request to ${host} after ${reason}`,
      data: { attempt, host, ...failure },
    });
    await pause(Math.random() * (MAX_WAITS_MS[attempt - 1] ?? 0), signal);
  }
}

/**
 * Whether a settled answer or error is a failure `retryRequest` would try again, or a DisTubeError marked `transient`.
 * A caller sets `transient: isTransientFailure(answerOrError)` on the DisTubeError it throws.
 */
export function isTransientFailure(value: unknown): boolean {
  if (DisTubeError.is(value)) return value.transient === true;
  return !cancelled(value) && failedRequest(value);
}
