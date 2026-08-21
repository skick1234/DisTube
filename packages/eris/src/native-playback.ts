import type { VoiceConnection } from "eris";

export type NativeCurrent = NonNullable<VoiceConnection["current"]>;

type StopObserver = (current: NativeCurrent | undefined) => void;

const errorSinks = new WeakSet<VoiceConnection>();

/**
 * Eris emits untagged socket errors before it knows whether it will reconnect. The permanent sink
 * prevents an unhandled EventEmitter error without turning an unclassified callback into a track outcome.
 */
export function ensureErisErrorSink(connection: VoiceConnection): void {
  if (errorSinks.has(connection)) return;
  errorSinks.add(connection);
  connection.on("error", () => undefined);
}

/**
 * Captures the current stream for stopPlaying callbacks while this Player owns the connection.
 *
 * If Eris invokes a stale scheduled stopPlaying after a newer stream became current, Eris has already
 * stopped that newer stream. The wrapper suppresses stale callbacks, but cannot reverse that native mutation.
 */
export function observeStopPlaying(connection: VoiceConnection, observe: StopObserver): () => void {
  const original = connection.stopPlaying;
  let active = true;
  const wrapped = (): void => {
    const current = connection.current ?? undefined;
    try {
      original.call(connection);
    } finally {
      if (active) observe(current);
    }
  };
  connection.stopPlaying = wrapped;

  return (): void => {
    if (!active) return;
    active = false;
    if (connection.stopPlaying === wrapped) connection.stopPlaying = original;
  };
}
