import { type Readable, Transform, type TransformCallback } from "node:stream";
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

/** Eris drains an `opusPackets` source with no backpressure unless it carries the `manualCB` pacing hooks. */
export function pacedOpusPackets(packets: Readable): Readable {
  const paced = new PacedOpusPackets();
  packets.pipe(paced);
  return paced;
}

class PacedOpusPackets extends Transform {
  manualCB = false;
  #next?: TransformCallback;

  constructor() {
    super({ objectMode: true, highWaterMark: 1 });
  }

  override _transform(packet: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.push(packet);
    if (this.manualCB) this.#next = callback;
    else callback();
  }

  transformCB(): void {
    const next = this.#next;
    this.#next = undefined;
    next?.();
  }
}
