import type { FilterEntry } from "../contracts";
import { RepeatMode } from "../enums";
import { DisTubeError } from "../errors";
import type { QueueItem } from "../media";

const DEFAULT_VOLUME = 100;

/**
 * Durable playback settings for one guild DisTubeVoice.
 *
 * The instance follows the voice lifetime. Volume, repeat and autoplay survive queue deletion;
 * filters reset through terminal cleanup. Leaving discards all settings.
 */
export class VoiceSettings {
  #volume = DEFAULT_VOLUME;
  #repeatMode: RepeatMode = RepeatMode.Off;
  #autoplay = false;
  #entries: readonly FilterEntry[] = Object.freeze([]);
  #lastPlayed?: QueueItem;

  get volume(): number {
    return this.#volume;
  }

  setVolume(percent: number): void {
    this.#volume = percent;
  }

  get repeatMode(): RepeatMode {
    return this.#repeatMode;
  }

  setRepeatMode(mode: RepeatMode): void {
    this.#repeatMode = mode;
  }

  get autoplay(): boolean {
    return this.#autoplay;
  }

  setAutoplay(enabled: boolean): void {
    this.#autoplay = enabled;
  }

  /** The committed filter entries in application order. */
  get entries(): readonly FilterEntry[] {
    return this.#entries;
  }

  setEntries(entries: readonly FilterEntry[]): void {
    this.#entries = entries;
  }

  get lastPlayed(): QueueItem | undefined {
    return this.#lastPlayed;
  }

  remember(items: readonly QueueItem[]): void {
    const latest = items.at(-1);
    if (latest) this.#lastPlayed = latest;
  }
}

export function validateVolume(percent: number): number {
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new DisTubeError("INVALID_ARGUMENT", "volume must be finite between 0 and 100");
  }
  return percent;
}

export function validateRepeatMode(mode: RepeatMode): RepeatMode {
  if (!Object.values(RepeatMode).includes(mode)) {
    throw new DisTubeError("INVALID_ARGUMENT", `Unknown repeat mode: ${String(mode)}`);
  }
  return mode;
}

export function validateAutoplay(enabled: boolean): boolean {
  if (typeof enabled !== "boolean") {
    throw new DisTubeError("INVALID_ARGUMENT", "autoplay must be a boolean");
  }
  return enabled;
}
