import { randomUUID } from "node:crypto";
import type { Adapter, CreateQueueOptions, SourcePlugin } from "./contracts";
import { DisTubeError, ErrorCode } from "./errors";
import type { QueueEventEmitter } from "./events";
import { GuildQueue } from "./GuildQueue";

/** @internal */
export class QueueManager {
  readonly #adapter: Adapter;
  readonly #sources: readonly SourcePlugin[];
  readonly #events: QueueEventEmitter;
  readonly #queues = new Map<string, GuildQueue>();
  readonly #bindings = new Map<string, string>();

  constructor(adapter: Adapter, sources: readonly SourcePlugin[], events: QueueEventEmitter) {
    this.#adapter = adapter;
    this.#sources = sources;
    this.#events = events;
  }

  create(options: CreateQueueOptions): GuildQueue {
    if (!options || typeof options.guildId !== "string" || options.guildId.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "guildId must be a non-empty string");
    }
    if (typeof options.channelId !== "string" || options.channelId.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "channelId must be a non-empty string");
    }
    const binding = `${options.guildId}:${options.channelId}`;
    if (this.#bindings.has(binding)) {
      throw new DisTubeError(ErrorCode.QUEUE_FAILED, "A GuildQueue already owns this guild/channel binding");
    }
    const queueId = randomUUID();
    const queue = new GuildQueue({ queueId, ...options }, this.#adapter, this.#sources, this.#events);
    this.#queues.set(queueId, queue);
    this.#bindings.set(binding, queueId);
    this.#events.emit("queue.created", Object.freeze({ queueId, timestamp: Date.now() }));
    return queue;
  }

  get(queueId: string): GuildQueue | undefined {
    return this.#queues.get(queueId);
  }

  async destroy(queueId: string): Promise<void> {
    const queue = this.#queues.get(queueId);
    if (!queue) throw new DisTubeError(ErrorCode.QUEUE_FAILED, `Unknown GuildQueue: ${queueId}`);
    await queue.destroy();
    this.#queues.delete(queueId);
    this.#bindings.delete(`${queue.guildId}:${queue.channelId}`);
  }

  values(): readonly GuildQueue[] {
    return Object.freeze([...this.#queues.values()]);
  }
}
