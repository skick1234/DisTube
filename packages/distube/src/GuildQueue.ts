import type { Adapter, Player, PlayerEvent, QueueBinding } from "./contracts";
import { asDisTubeError, DisTubeError, ErrorCode } from "./errors";
import type { QueueEventEmitter } from "./events";
import { QueueItem, Song } from "./media";
import { type OwnedPlaybackResource, preparePlaybackResource } from "./playback/prepare";
import { requireSongOwner, type SourceCatalog, validateSourceSongs } from "./playback/sources";
import { validatePlaybackRequest } from "./playback/validation";
import { CleanupBarrier } from "./queue/cleanup";
import { runDetachedEffect } from "./queue/effects";
import { Mailbox } from "./queue/mailbox";
import type {
  ActivePlayback,
  EnqueueCompletion,
  EnqueueOperation,
  PlaybackAttempt,
  QueueMessage,
} from "./queue/protocol";
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
  readonly #sources: SourceCatalog;
  readonly #events: QueueEventEmitter;
  readonly #mailbox: Mailbox<QueueMessage>;
  readonly #enqueueOperations = new Map<number, EnqueueOperation>();
  readonly #enqueueCompletions = new Map<number, EnqueueCompletion>();
  #state: QueueState = IDLE_QUEUE_STATE;
  #player?: Player;
  #unsubscribe?: () => void;
  #attempt?: PlaybackAttempt;
  #active?: ActivePlayback;
  #nextEnqueueSequence = 0;
  #nextEnqueueCommit = 0;
  #destroyRequested = false;
  #destroyed = false;
  #destroyEventEmitted = false;
  #cleanupBarrier?: CleanupBarrier;
  #terminalPromise?: Promise<void>;
  #destroyPromise?: Promise<void>;

  /** @internal */
  constructor(binding: QueueBinding, adapter: Adapter, sources: SourceCatalog, events: QueueEventEmitter) {
    this.id = binding.queueId;
    this.guildId = binding.guildId;
    this.channelId = binding.channelId;
    this.#adapter = adapter;
    this.#sources = sources;
    this.#events = events;
    this.#mailbox = new Mailbox(message => this.#handle(message));
  }

  get state(): QueueState {
    return this.#state;
  }

  enqueue(source: string | Song, metadata?: Readonly<Record<string, unknown>>): Promise<readonly QueueItem[]> {
    return new Promise((resolve, reject) => {
      const operation: EnqueueOperation = {
        sequence: this.#nextEnqueueSequence++,
        controller: new AbortController(),
        ...(metadata ? { metadata } : {}),
        resolve,
        reject,
      };
      this.#mailbox.post({ type: "enqueue", source, operation });
    });
  }

  remove(itemId: string): Promise<QueueItem> {
    return new Promise((resolve, reject) => this.#mailbox.post({ type: "remove", itemId, resolve, reject }));
  }

  skip(): Promise<void> {
    return new Promise((resolve, reject) => this.#mailbox.post({ type: "skip", resolve, reject }));
  }

  pause(): Promise<void> {
    return this.#control("pause");
  }

  resume(): Promise<void> {
    return this.#control("resume");
  }

  seek(seconds: number): Promise<void> {
    return this.#control("seek", seconds);
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => this.#mailbox.post({ type: "stop", resolve, reject }));
  }

  destroy(): Promise<void> {
    this.#destroyRequested = true;
    this.#attempt?.controller.abort(this.#stale());
    this.#destroyPromise ??= new Promise((resolve, reject) => this.#mailbox.post({ type: "destroy", resolve, reject }));
    return this.#destroyPromise;
  }

  #control(control: "pause" | "resume" | "seek", seconds?: number): Promise<void> {
    return new Promise((resolve, reject) =>
      this.#mailbox.post({
        type: "control",
        control,
        ...(seconds === undefined ? {} : { seconds }),
        resolve,
        reject,
      }),
    );
  }

  #handle(message: QueueMessage): void {
    switch (message.type) {
      case "enqueue":
        this.#acceptEnqueue(message.source, message.operation);
        break;
      case "enqueue.completed":
        this.#completeEnqueue(message.completion);
        break;
      case "start":
        this.#startNext();
        break;
      case "player.ready":
        this.#completePlayer(message);
        break;
      case "preparation.completed":
        this.#completePreparation(message);
        break;
      case "play.completed":
        this.#completePlay(message);
        break;
      case "player.outcome":
        this.#completeOutcome(message.player, message.event);
        break;
      case "remove":
        this.#remove(message);
        break;
      case "control":
        this.#beginControl(message);
        break;
      case "control.completed":
        this.#completeControl(message);
        break;
      case "skip":
        this.#beginSkip(message);
        break;
      case "skip.completed":
        this.#completeSkip(message);
        break;
      case "stop":
        this.#terminalize(false, message.resolve, message.reject);
        break;
      case "destroy":
        this.#terminalize(true, message.resolve, message.reject);
        break;
    }
  }

  #acceptEnqueue(source: string | Song, operation: EnqueueOperation): void {
    try {
      this.#assertActive();
      this.#enqueueOperations.set(operation.sequence, operation);
      this.#runEffect(async () => {
        try {
          const songs = await this.#resolve(source, operation.controller.signal);
          this.#mailbox.post({ type: "enqueue.completed", completion: { operation, songs } });
        } catch (error: unknown) {
          this.#mailbox.post({ type: "enqueue.completed", completion: { operation, error } });
        }
      });
    } catch (error: unknown) {
      operation.reject(error);
    }
  }

  #completeEnqueue(completion: EnqueueCompletion): void {
    const operation = this.#enqueueOperations.get(completion.operation.sequence);
    if (operation !== completion.operation) return;
    this.#enqueueCompletions.set(operation.sequence, completion);
    this.#drainEnqueues();
  }

  #drainEnqueues(): void {
    while (true) {
      const completion = this.#enqueueCompletions.get(this.#nextEnqueueCommit);
      if (!completion) break;
      const { operation } = completion;
      this.#enqueueCompletions.delete(operation.sequence);
      this.#enqueueOperations.delete(operation.sequence);
      this.#nextEnqueueCommit += 1;
      if ("error" in completion) {
        operation.reject(asDisTubeError(ErrorCode.SOURCE_FAILED, "Source resolution failed", completion.error));
        continue;
      }
      const items = Object.freeze(completion.songs.map(song => new QueueItem({ song, metadata: operation.metadata })));
      this.#state = appendItems(this.#state, items);
      const timestamp = Date.now();
      this.#runEffect(async () => {
        for (const item of items) this.#emit("queue.item.added", { item }, timestamp);
        operation.resolve(items);
        this.#mailbox.post({ type: "start" });
      });
    }
  }

  #startNext(): void {
    if (this.#destroyed || this.#attempt || this.#active || this.#state.current || !this.#state.items[0]) return;
    const attempt: PlaybackAttempt = {
      item: this.#state.items[0],
      controller: new AbortController(),
      phase: this.#player ? "preparing" : "connecting",
      ...(this.#player ? { player: this.#player } : {}),
    };
    this.#attempt = attempt;
    if (attempt.player) this.#runPreparation(attempt, attempt.player);
    else this.#runPlayerCreation(attempt);
  }

  #runPlayerCreation(attempt: PlaybackAttempt): void {
    this.#runEffect(async () => {
      let player: Player | undefined;
      let unsubscribe: (() => void) | undefined;
      try {
        player = await this.#adapter.createPlayer({
          queueId: this.id,
          guildId: this.guildId,
          channelId: this.channelId,
        });
        const exactPlayer = player;
        unsubscribe = player.subscribe(event =>
          this.#mailbox.post({ type: "player.outcome", player: exactPlayer, event }),
        );
        this.#mailbox.post({
          type: "player.ready",
          attempt,
          player,
          unsubscribe,
        });
      } catch (error: unknown) {
        if (player) await player.stop().catch(stopError => this.#report(stopError, "late Player cleanup"));
        unsubscribe?.();
        this.#mailbox.post({
          type: "player.ready",
          attempt,
          error,
        });
      }
    });
  }

  #completePlayer(message: Extract<QueueMessage, { type: "player.ready" }>): void {
    const attempt = this.#currentAttempt(message.attempt);
    if (!attempt) {
      message.unsubscribe?.();
      if (message.player) this.#runPlayerStop(message.player, "stale Player creation");
      return;
    }
    if (message.error || !message.player || !message.unsubscribe) {
      this.#failWaitingAttempt(
        attempt,
        asDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to create Player", message.error),
      );
      return;
    }
    this.#player = message.player;
    this.#unsubscribe = message.unsubscribe;
    attempt.player = message.player;
    attempt.phase = "preparing";
    this.#runPreparation(attempt, message.player);
  }

  #runPreparation(attempt: PlaybackAttempt, player: Player): void {
    this.#runEffect(async () => {
      try {
        const resource = await preparePlaybackResource(
          attempt.item.song,
          this.#sources,
          attempt.controller.signal,
          (error, stage) => this.#report(error, stage),
        );
        this.#mailbox.post({
          type: "preparation.completed",
          attempt,
          player,
          resource,
        });
      } catch (error: unknown) {
        this.#mailbox.post({
          type: "preparation.completed",
          attempt,
          player,
          error,
        });
      }
    });
  }

  #completePreparation(message: Extract<QueueMessage, { type: "preparation.completed" }>): void {
    const attempt = this.#currentAttempt(message.attempt, message.player);
    if (!attempt) {
      if (message.resource) this.#runDisposal(message.resource, "stale preparation");
      return;
    }
    if (message.error || !message.resource) {
      this.#failWaitingAttempt(
        attempt,
        asDisTubeError(ErrorCode.SOURCE_FAILED, "Source failed to prepare QueueItem", message.error),
      );
      return;
    }
    attempt.resource = message.resource;
    attempt.phase = "activating";
    this.#runEffect(async () => {
      try {
        const request = validatePlaybackRequest({ itemId: attempt.item.id, resource: message.resource?.resource });
        await message.player.play(request);
        this.#mailbox.post({
          type: "play.completed",
          attempt,
          player: message.player,
          resource: message.resource as OwnedPlaybackResource,
        });
      } catch (error: unknown) {
        this.#mailbox.post({
          type: "play.completed",
          attempt,
          player: message.player,
          resource: message.resource as OwnedPlaybackResource,
          error,
        });
      }
    });
  }

  #completePlay(message: Extract<QueueMessage, { type: "play.completed" }>): void {
    const attempt = this.#currentAttempt(message.attempt, message.player);
    if (!attempt) {
      this.#runDisposal(message.resource, "stale Player activation");
      return;
    }
    if (message.error) {
      this.#attempt = undefined;
      attempt.controller.abort(this.#stale());
      this.#state = failFirst(this.#state, attempt.item.id);
      const timestamp = Date.now();
      const error = asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to start QueueItem", message.error);
      const player = this.#retirePlayer(message.player);
      this.#runEffect(async () => {
        this.#emit("queue.item.failed", { item: attempt.item, error }, timestamp);
        if (player) await player.stop().catch(cleanup => this.#report(cleanup, "Player cleanup after play rejection"));
        await message.resource
          .dispose()
          .catch(cleanup => this.#report(cleanup, "resource cleanup after play rejection"));
        this.#mailbox.post({ type: "start" });
      });
      return;
    }
    const selected = startFirst(this.#state);
    if (!selected || selected.item.id !== attempt.item.id) {
      this.#attempt = undefined;
      this.#runDisposal(message.resource, "superseded Player activation");
      return;
    }
    this.#state = selected.state;
    const timestamp = Date.now();
    this.#attempt = undefined;
    this.#active = Object.freeze({ item: attempt.item, player: message.player, resource: message.resource });
    this.#runEffect(async () => this.#emit("queue.item.started", { item: attempt.item }, timestamp));
  }

  #completeOutcome(player: Player, event: PlayerEvent): void {
    const active = this.#active;
    if (
      !active ||
      active.player !== player ||
      event.itemId !== active.item.id ||
      this.#state.current?.id !== active.item.id
    ) {
      return;
    }
    this.#active = undefined;
    this.#state = finishCurrent(this.#state);
    const terminalPlayer = event.type === "failed" && event.terminal ? this.#retirePlayer(player) : undefined;
    const timestamp = Date.now();
    this.#runEffect(async () => {
      if (event.type === "finished") this.#emit("queue.item.finished", { item: active.item }, timestamp);
      else {
        this.#emit(
          "queue.item.failed",
          {
            item: active.item,
            error: asDisTubeError(ErrorCode.VOICE_FAILED, "Player reported playback failure", event.error),
          },
          timestamp,
        );
      }
      if (terminalPlayer) {
        await terminalPlayer.stop().catch(error => this.#report(error, "terminal Player outcome cleanup"));
      }
      await active.resource.dispose().catch(error => this.#report(error, "resource cleanup after Player outcome"));
      this.#mailbox.post({ type: "start" });
    });
  }

  #remove(message: Extract<QueueMessage, { type: "remove" }>): void {
    try {
      this.#assertActive();
      const result = removeItem(this.#state, message.itemId);
      this.#state = result.state;
      const attempt = this.#attempt?.item.id === message.itemId ? this.#attempt : undefined;
      if (!attempt) {
        message.resolve(result.item);
        return;
      }
      attempt.controller.abort(this.#stale());
      this.#attempt = undefined;
      const resource = attempt.resource;
      const player = attempt.phase === "activating" && attempt.player ? this.#retirePlayer(attempt.player) : undefined;
      message.resolve(result.item);
      this.#runEffect(async () => {
        if (player) await player.stop().catch(error => this.#report(error, "Player cleanup after selected removal"));
        if (resource)
          await resource.dispose().catch(error => this.#report(error, "resource cleanup after selected removal"));
        this.#mailbox.post({ type: "start" });
      });
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  #beginControl(message: Extract<QueueMessage, { type: "control" }>): void {
    try {
      this.#assertActive();
      const active = this.#active;
      if (!active || this.#state.current?.id !== active.item.id || this.#player !== active.player) {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Queue has no current QueueItem");
      }
      if (message.control === "pause" && this.#state.status === "paused") {
        message.resolve();
        return;
      }
      if (message.control === "resume" && this.#state.status === "playing") {
        message.resolve();
        return;
      }
      if (message.control === "seek" && (!Number.isFinite(message.seconds) || (message.seconds ?? -1) < 0)) {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Seek seconds must be non-negative");
      }
      this.#runEffect(async () => {
        let error: unknown;
        try {
          if (message.control === "pause") await active.player.pause();
          else if (message.control === "resume") await active.player.resume();
          else await active.player.seek(message.seconds as number);
        } catch (cause: unknown) {
          error = cause;
        }
        this.#mailbox.post({
          type: "control.completed",
          control: message.control,
          itemId: active.item.id,
          player: active.player,
          resolve: message.resolve,
          reject: message.reject,
          ...(error === undefined ? {} : { error }),
        });
      });
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  #completeControl(message: Extract<QueueMessage, { type: "control.completed" }>): void {
    const active = this.#active;
    if (
      !active ||
      active.item.id !== message.itemId ||
      active.player !== message.player ||
      this.#player !== message.player
    ) {
      message.reject(this.#stale());
      return;
    }
    if (message.error) {
      message.reject(asDisTubeError(ErrorCode.VOICE_FAILED, `Player failed to ${message.control}`, message.error));
      return;
    }
    if (message.control === "pause") this.#state = setStatus(this.#state, "paused");
    else if (message.control === "resume") this.#state = setStatus(this.#state, "playing");
    message.resolve();
  }

  #beginSkip(message: Extract<QueueMessage, { type: "skip" }>): void {
    try {
      this.#assertActive();
      const active = this.#active;
      if (!active || this.#state.current?.id !== active.item.id || this.#player !== active.player) {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Cannot skip an idle queue");
      }
      this.#retirePlayer(active.player);
      this.#runEffect(async () => {
        let error: unknown;
        try {
          await active.player.stop();
        } catch (cause: unknown) {
          error = cause;
        }
        this.#mailbox.post({
          type: "skip.completed",
          itemId: active.item.id,
          player: active.player,
          active,
          resolve: message.resolve,
          reject: message.reject,
          ...(error === undefined ? {} : { error }),
        });
      });
    } catch (error: unknown) {
      message.reject(error);
    }
  }

  #completeSkip(message: Extract<QueueMessage, { type: "skip.completed" }>): void {
    if (this.#active !== message.active || this.#state.current?.id !== message.itemId) {
      message.reject(this.#stale());
      return;
    }
    this.#active = undefined;
    this.#state = finishCurrent(this.#state);
    const timestamp = Date.now();
    this.#runEffect(async () => {
      this.#emit("queue.item.finished", { item: message.active.item }, timestamp);
      const failures: Error[] = [];
      if (message.error) failures.push(asError(message.error));
      try {
        await message.active.resource.dispose();
      } catch (error: unknown) {
        failures.push(asError(error));
      }
      if (failures.length === 0) message.resolve();
      else {
        message.reject(
          new DisTubeError(ErrorCode.VOICE_FAILED, "Player failed to skip cleanly", {
            cause: failures.length === 1 ? failures[0] : new AggregateError(failures, "Skip cleanup failures"),
          }),
        );
      }
      this.#mailbox.post({ type: "start" });
    });
  }

  #terminalize(destroy: boolean, resolve: () => void, reject: (error: unknown) => void): void {
    if (destroy) {
      this.#destroyRequested = true;
      this.#destroyed = true;
    }
    if (this.#terminalPromise) {
      if (destroy && !this.#destroyEventEmitted) {
        this.#destroyEventEmitted = true;
        this.#emit("queue.destroyed", {}, Date.now());
      }
      this.#terminalPromise.then(resolve, reject);
      return;
    }
    if (!destroy && this.#destroyed) {
      reject(new DisTubeError(ErrorCode.QUEUE_FAILED, "GuildQueue is destroyed"));
      return;
    }
    this.#cancelEnqueues();
    const attempt = this.#attempt;
    attempt?.controller.abort(this.#stale());
    this.#attempt = undefined;
    const active = this.#active;
    this.#active = undefined;
    this.#state = clearQueue(this.#state);
    if (destroy && !this.#destroyEventEmitted) {
      this.#destroyEventEmitted = true;
      this.#emit("queue.destroyed", {}, Date.now());
    }
    const player = this.#retirePlayer(this.#player);
    const resources = [...new Set([attempt?.resource, active?.resource].filter(Boolean))] as OwnedPlaybackResource[];
    const barrier = new CleanupBarrier();
    this.#cleanupBarrier = barrier;
    if (player) barrier.add(() => player.stop());
    for (const resource of resources) barrier.add(() => resource.dispose());
    const terminal = barrier
      .settle()
      .then(failures => {
        if (failures.length === 0) return;
        throw new DisTubeError(player ? ErrorCode.VOICE_FAILED : ErrorCode.QUEUE_FAILED, "Queue cleanup failed", {
          cause: failures.length === 1 ? failures[0] : new AggregateError(failures, "Queue cleanup failures"),
        });
      })
      .finally(() => {
        if (this.#cleanupBarrier === barrier) this.#cleanupBarrier = undefined;
        if (!this.#destroyed && this.#terminalPromise === terminal) this.#terminalPromise = undefined;
      });
    this.#terminalPromise = terminal;
    terminal.then(resolve, reject);
  }

  async #resolve(source: string | Song, signal: AbortSignal): Promise<readonly Song[]> {
    if (source instanceof Song) {
      requireSongOwner(source, this.#sources);
      throwIfAborted(signal);
      return Object.freeze([source]);
    }
    if (typeof source !== "string" || source.length === 0) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "enqueue source must be a Song or non-empty URL");
    }
    for (const plugin of this.#sources.ordered) {
      let result: Song | readonly Song[] | undefined;
      try {
        result = await plugin.resolve(source, { signal });
      } catch (error: unknown) {
        throwIfAborted(signal);
        throw asDisTubeError(ErrorCode.SOURCE_FAILED, `${plugin.name} failed to resolve source`, error);
      }
      throwIfAborted(signal);
      if (!result) continue;
      return validateSourceSongs(result, plugin, "resolve");
    }
    throw new DisTubeError(ErrorCode.SOURCE_FAILED, "No SourcePlugin resolved the source");
  }

  #failWaitingAttempt(attempt: PlaybackAttempt, error: DisTubeError): void {
    if (this.#attempt !== attempt) return;
    this.#attempt = undefined;
    attempt.controller.abort(this.#stale());
    this.#state = failFirst(this.#state, attempt.item.id);
    const timestamp = Date.now();
    this.#runEffect(async () => {
      this.#emit("queue.item.failed", { item: attempt.item, error }, timestamp);
      if (attempt.resource) {
        await attempt.resource
          .dispose()
          .catch(cleanup => this.#report(cleanup, "resource cleanup after source failure"));
      }
      this.#mailbox.post({ type: "start" });
    });
  }

  #currentAttempt(attempt: PlaybackAttempt, player?: Player): PlaybackAttempt | undefined {
    if (this.#attempt !== attempt || this.#destroyRequested) return undefined;
    if (player && (attempt.player !== player || this.#player !== player)) return undefined;
    return attempt;
  }

  #cancelEnqueues(): void {
    for (const operation of this.#enqueueOperations.values()) {
      operation.controller.abort(this.#stale());
      operation.reject(this.#stale());
    }
    this.#enqueueOperations.clear();
    this.#enqueueCompletions.clear();
    this.#nextEnqueueCommit = this.#nextEnqueueSequence;
  }

  #retirePlayer(player: Player | undefined): Player | undefined {
    if (!player || this.#player !== player) return player;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#player = undefined;
    return player;
  }

  #runPlayerStop(player: Player, stage: string): void {
    if (this.#cleanupBarrier?.add(() => player.stop())) return;
    this.#runEffect(async () => player.stop().catch(error => this.#report(error, stage)));
  }

  #runDisposal(resource: OwnedPlaybackResource, stage: string): void {
    if (this.#cleanupBarrier?.add(() => resource.dispose())) return;
    this.#runEffect(async () => resource.dispose().catch(error => this.#report(error, stage)));
  }

  #runEffect(effect: () => void | Promise<void>): void {
    runDetachedEffect(effect, error => this.#report(error, "GuildQueue effect"));
  }

  #assertActive(): void {
    if (this.#destroyRequested || this.#destroyed) {
      throw new DisTubeError(ErrorCode.QUEUE_FAILED, "GuildQueue is destroyed");
    }
  }

  #stale(): DisTubeError {
    return new DisTubeError(ErrorCode.QUEUE_FAILED, "Queue operation was superseded");
  }

  #report(error: unknown, stage: string): void {
    this.#events.report({
      severity: "error",
      stage,
      message: `GuildQueue ${this.id} background operation failed`,
      error: asError(error),
      detail: Object.freeze({ queueId: this.id }),
    });
  }

  #emit<
    Name extends
      | "queue.item.added"
      | "queue.item.started"
      | "queue.item.finished"
      | "queue.item.failed"
      | "queue.destroyed",
  >(
    name: Name,
    detail: Omit<Parameters<QueueEventEmitter["emit"]>[1], "queueId" | "timestamp">,
    timestamp: number,
  ): void {
    this.#events.emit(name, Object.freeze({ queueId: this.id, timestamp, ...detail }) as never);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Queue operation aborted");
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
