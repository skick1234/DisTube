import { randomUUID } from "node:crypto";
import type { Adapter, CreateQueueOptions } from "./contracts";
import { DisTubeError, ErrorCode } from "./errors";
import type { QueueEventEmitter } from "./events";
import { GuildQueue } from "./GuildQueue";
import type { SourceCatalog } from "./playback/sources";
import { settleAll } from "./utils/dispose";

/** @internal */
export class QueueManager {
  readonly #adapter: Adapter;
  readonly #sources: SourceCatalog;
  readonly #events: QueueEventEmitter;
  readonly #queues = new Map<string, GuildQueue>();
  readonly #guilds = new Map<string, string>();

  constructor(adapter: Adapter, sources: SourceCatalog, events: QueueEventEmitter) {
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
    if (this.#guilds.has(options.guildId)) {
      throw new DisTubeError(ErrorCode.QUEUE_FAILED, "A GuildQueue already owns this guild");
    }
    const queueId = randomUUID();
    const queue = new GuildQueue({ queueId, ...options }, this.#adapter, this.#sources, this.#events);
    this.#queues.set(queueId, queue);
    this.#guilds.set(options.guildId, queueId);
    this.#events.emit("queue.created", Object.freeze({ queueId, timestamp: Date.now() }));
    return queue;
  }

  get(queueId: string): GuildQueue | undefined {
    return this.#queues.get(queueId);
  }

  async destroy(queueId: string): Promise<void> {
    const queue = this.#queues.get(queueId);
    if (!queue) throw new DisTubeError(ErrorCode.QUEUE_FAILED, `Unknown GuildQueue: ${queueId}`);
    this.#queues.delete(queueId);
    this.#guilds.delete(queue.guildId);
    await queue.destroy();
  }

  destroyAll(): Promise<readonly Error[]> {
    const queues = [...this.#queues.values()];
    this.#queues.clear();
    this.#guilds.clear();
    const completions = queues.map(queue => queue.destroy());
    return settleAll(completions.map(completion => () => completion));
  }
}
