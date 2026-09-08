import { abortFailure } from "../errors";

/**
 * Stops cooperative work the moment its signal aborts.
 *
 * The thrown value is always a `ABORTED` DisTubeError, never the platform abort reason, so a
 * cancelled resolution, search, or preparation reaches bot code as the same error every other
 * cancellation does.
 */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortFailure(signal.reason);
}
