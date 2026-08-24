import type { FilterEntry } from "../contracts";
import { ErrorReason, RepeatMode } from "../enums";
import { DisTubeError, ErrorCode } from "../errors";
import type { QueueItem } from "../media";
import { NO_FILTERS } from "./filters";

/** How many played occurrences the Voice keeps before dropping the oldest. */
export const HISTORY_LIMIT = 100;
const DEFAULT_VOLUME = 100;

/**
 * Durable playback settings for one guild Voice.
 *
 * The instance lives exactly as long as its Voice: queue creation, stop, exhaustion, deletion, and
 * channel movement never touch it, and building a fresh Voice on the next join restores defaults.
 */
export class VoiceSettings {
  #volume = DEFAULT_VOLUME;
  #repeatMode: RepeatMode = RepeatMode.Off;
  #autoplay = false;
  #entries: readonly FilterEntry[] = NO_FILTERS;
  readonly #history: QueueItem[] = [];

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

  /** Played occurrences, oldest first, capped at the newest {@link HISTORY_LIMIT}. */
  get previousSongs(): readonly QueueItem[] {
    return Object.freeze([...this.#history]);
  }

  /** Appends played occurrences, dropping the oldest once the history outgrows its cap. */
  remember(items: readonly QueueItem[]): void {
    if (items.length === 0) return;
    this.#history.push(...items);
    if (this.#history.length > HISTORY_LIMIT) this.#history.splice(0, this.#history.length - HISTORY_LIMIT);
  }

  /** Removes and returns the newest played occurrence, for `previous()` replay. */
  popPrevious(): QueueItem | undefined {
    return this.#history.pop();
  }
}

export function validateVolume(percent: number): number {
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) {
    throw new DisTubeError(
      ErrorCode.INVALID_ARGUMENT,
      ErrorReason.Argument,
      "volume must be a non-negative finite number",
    );
  }
  return percent;
}

export function validateRepeatMode(mode: RepeatMode): RepeatMode {
  if (!Object.values(RepeatMode).includes(mode)) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, `Unknown repeat mode: ${String(mode)}`);
  }
  return mode;
}

export function validateAutoplay(enabled: boolean): boolean {
  if (typeof enabled !== "boolean") {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "autoplay must be a boolean");
  }
  return enabled;
}
