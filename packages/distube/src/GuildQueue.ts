import type { Adapter, Player, PlayerEvent, QueueBinding, SourcePlugin } from "./contracts";
import { asDisTubeError, DisTubeError, ErrorCode } from "./errors";
import type { QueueEventEmitter } from "./events";
import { QueueItem, Song } from "./media";
import {
  appendItems,
  clearQueue,
  failFirst,
  finishCurrent,
  IDLE_QUEUE_STATE,
  type QueueState,
  removeItem,
  setStatus,
  startFirst,
} from "./queue/state";

export class GuildQueue {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly #adapter: Adapter;
  readonly #sources: readonly SourcePlugin[];
  readonly #events: QueueEventEmitter;
  #state: QueueState = IDLE_QUEUE_STATE;
  #player?: Player;
  #unsubscribe?: () => void;
  #generation = 0;
  #destroyed = false;
  #starting?: Promise<void>;
  #tail: Promise<unknown> = Promise.resolve();

  /** @internal */
  constructor(binding: QueueBinding, adapter: Adapter, sources: readonly SourcePlugin[], events: QueueEventEmitter) {
    this.id = binding.queueId;
    this.guildId = binding.guildId;
    this.channelId = binding.channelId;
    this.#adapter = adapter;
    this.#sources = sources;
    this.#events = events;
  }

  get state(): QueueState {
    return this.#state;
  }

  enqueue(source: string | Song, metadata?: Readonly<Record<string, unknown>>): Promise<readonly QueueItem[]> {
    return this.#ordered(async () => {
      this.#assertActive();
      const generation = this.#generation;
      const songs = await this.#resolve(source);
      if (generation !== this.#generation || this.#destroyed) throw this.#stale();
      const items = songs.map(song => new QueueItem({ song, metadata }));
      this.#state = appendItems(this.#state, items);
      for (const item of items) this.#emit("queue.item.added", { item });
      await this.#startNext();
      return Object.freeze(items);
    });
  }

  remove(itemId: string): Promise<QueueItem> {
    return this.#ordered(() => {
      this.#assertActive();
      const result = removeItem(this.#state, itemId);
      this.#state = result.state;
      return result.item;
    });
  }

  async skip(): Promise<void> {
    this.#assertActive();
    const current = this.#state.current;
    if (!current) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Cannot skip an idle queue");
    this.#generation += 1;
    try {
      await this.#stopPlayer();
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to skip", error);
    }
    this.#state = finishCurrent(this.#state);
    this.#emit("queue.item.finished", { item: current });
    await this.#startNext();
  }

  async pause(): Promise<void> {
    this.#assertPlaying();
    if (this.#state.status === "paused") return;
    try {
      await this.#player?.pause();
      this.#state = setStatus(this.#state, "paused");
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to pause", error);
    }
  }

  async resume(): Promise<void> {
    this.#assertPlaying();
    if (this.#state.status === "playing") return;
    try {
      await this.#player?.resume();
      this.#state = setStatus(this.#state, "playing");
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to resume", error);
    }
  }

  async seek(seconds: number): Promise<void> {
    this.#assertPlaying();
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Seek seconds must be non-negative");
    }
    try {
      await this.#player?.seek(seconds);
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to seek", error);
    }
  }

  async stop(): Promise<void> {
    this.#assertActive();
    this.#generation += 1;
    if (!this.#state.current && this.#state.items.length === 0 && !this.#starting) return;
    try {
      await this.#stopPlayer();
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to stop", error);
    }
    this.#state = clearQueue(this.#state);
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#generation += 1;
    this.#state = clearQueue(this.#state);
    try {
      await this.#stopPlayer();
    } finally {
      this.#emit("queue.destroyed", {});
    }
  }

  #ordered<Result>(operation: () => Result | Promise<Result>): Promise<Result> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async #resolve(source: string | Song): Promise<readonly Song[]> {
    if (source instanceof Song) return Object.freeze([source]);
    if (typeof source !== "string" || source.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "enqueue source must be a Song or non-empty URL");
    }
    for (const plugin of this.#sources) {
      let result: Song | readonly Song[] | undefined;
      try {
        result = await plugin.resolve(source);
      } catch (error: unknown) {
        throw asDisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} failed to resolve source`, error);
      }
      if (!result) continue;
      const songs = result instanceof Song ? [result] : [...result];
      if (songs.length === 0 || songs.some(song => !(song instanceof Song))) {
        throw new DisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} returned invalid media`);
      }
      return Object.freeze(songs);
    }
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, "No SourcePlugin resolved the source");
  }

  #startNext(): Promise<void> {
    if (this.#starting) return this.#starting;
    const selected = startFirst(this.#state);
    if (!selected) return Promise.resolve();
    const generation = this.#generation;
    const start = async (): Promise<void> => {
      try {
        const player = await this.#getPlayer();
        await player.play(selected.item);
        if (generation !== this.#generation || this.#destroyed) throw this.#stale();
        this.#state = selected.state;
        this.#emit("queue.item.started", { item: selected.item });
      } catch (error: unknown) {
        if (generation !== this.#generation || this.#destroyed) throw this.#stale();
        this.#state = failFirst(this.#state, selected.item.id);
        const failure = asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to start QueueItem", error);
        this.#emit("queue.item.failed", { item: selected.item, error: failure });
        await this.#startNextAfterCurrent();
      }
    };
    this.#starting = start().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #startNextAfterCurrent(): Promise<void> {
    const selected = startFirst(this.#state);
    if (!selected) return;
    try {
      const player = await this.#getPlayer();
      await player.play(selected.item);
      this.#state = selected.state;
      this.#emit("queue.item.started", { item: selected.item });
    } catch (error: unknown) {
      this.#state = failFirst(this.#state, selected.item.id);
      this.#emit("queue.item.failed", {
        item: selected.item,
        error: asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to start QueueItem", error),
      });
      await this.#startNextAfterCurrent();
    }
  }

  async #getPlayer(): Promise<Player> {
    if (this.#player) return this.#player;
    let player: Player;
    try {
      player = await this.#adapter.createPlayer({ queueId: this.id, guildId: this.guildId, channelId: this.channelId });
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to create Player", error);
    }
    this.#player = player;
    this.#unsubscribe = player.subscribe(event => this.#handlePlayerEvent(player, event));
    return player;
  }

  #handlePlayerEvent(player: Player, event: PlayerEvent): void {
    if (player !== this.#player || event.itemId !== this.#state.current?.id || this.#destroyed) return;
    const current = this.#state.current;
    if (!current) return;
    this.#generation += 1;
    this.#state = finishCurrent(this.#state);
    if (event.type === "finished") this.#emit("queue.item.finished", { item: current });
    else {
      this.#emit("queue.item.failed", {
        item: current,
        error: asDisTubeError(ErrorCode.VOICE_FAILED, "Player reported playback failure", event.error),
      });
    }
    void this.#startNext();
  }

  async #stopPlayer(): Promise<void> {
    const player = this.#player;
    if (!player) return;
    await player.stop();
    if (this.#player !== player) return;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#player = undefined;
  }

  #assertActive(): void {
    if (this.#destroyed) throw new DisTubeError(ErrorCode.QUEUE_FAILED, "GuildQueue is destroyed");
  }

  #assertPlaying(): void {
    this.#assertActive();
    if (!this.#state.current || !this.#player) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Queue has no current QueueItem");
    }
  }

  #stale(): DisTubeError {
    return new DisTubeError(ErrorCode.QUEUE_FAILED, "Queue operation was superseded");
  }

  #emit<
    Name extends
      | "queue.item.added"
      | "queue.item.started"
      | "queue.item.finished"
      | "queue.item.failed"
      | "queue.destroyed",
  >(name: Name, detail: Omit<Parameters<QueueEventEmitter["emit"]>[1], "queueId" | "timestamp">): void {
    this.#events.emit(name, Object.freeze({ queueId: this.id, timestamp: Date.now(), ...detail }) as never);
  }
}
