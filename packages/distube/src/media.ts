import { randomUUID } from "node:crypto";
import { DisTubeError, ErrorCode } from "./errors";
import { immutableClone } from "./utils/immutable";

export interface SongData {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly duration: number;
  readonly source: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class Song {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly duration: number;
  readonly source: string;
  readonly #metadata: Readonly<Record<string, unknown>>;

  constructor(data: SongData) {
    if (!data || typeof data.id !== "string" || data.id.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song id must be a non-empty string");
    }
    if (typeof data.title !== "string" || data.title.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song title must be a non-empty string");
    }
    if (typeof data.url !== "string" || data.url.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song url must be a non-empty string");
    }
    if (!Number.isFinite(data.duration) || data.duration < 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song duration must be a non-negative number");
    }
    if (typeof data.source !== "string" || data.source.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song source must be a non-empty string");
    }
    this.id = data.id;
    this.title = data.title;
    this.url = data.url;
    this.duration = data.duration;
    this.source = data.source;
    this.#metadata = immutableClone(data.metadata ?? {});
    Object.freeze(this);
  }

  get metadata(): Readonly<Record<string, unknown>> {
    return immutableClone(this.#metadata);
  }
}

export interface QueueItemData {
  readonly song: Song;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class QueueItem {
  readonly id: string;
  readonly song: Song;
  readonly #metadata: Readonly<Record<string, unknown>>;
  readonly #addedAt: Date;

  constructor(data: QueueItemData) {
    if (!(data?.song instanceof Song)) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "QueueItem song must be a Song");
    }
    this.id = randomUUID();
    this.song = data.song;
    this.#metadata = immutableClone(data.metadata ?? {});
    this.#addedAt = new Date();
    Object.freeze(this);
  }

  get addedAt(): Date {
    return new Date(this.#addedAt.getTime());
  }

  get metadata(): Readonly<Record<string, unknown>> {
    return immutableClone(this.#metadata);
  }
}
