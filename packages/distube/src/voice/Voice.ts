import type { Engine, Player, VoiceGatewayData, VoiceSession, VoiceSessionEvent } from "../contracts";
import { asDisTubeError, asError, DisTubeError, ErrorCode } from "../errors";
import { cleanupFailure } from "../queue/failures";
import type {
  LeasedPlayerOutcome,
  QueueItemAuthority,
  QueueLeaseRequest,
  QueuePlayerEffect,
  QueueVoice,
  QueueVoiceLease,
} from "../queue/voice";
import { settleGrowing, TrackedWork } from "../utils/tracked-work";

/** Public guild voice facade. */
export type Voice = {
  readonly guildId: string;
  readonly channelId: string;
  join(channelId: string): Promise<void>;
};

type VoicePhase = "open" | "fenced" | "released";

interface PlayerRecord {
  readonly generation: number;
  readonly player: Player;
  readonly unsubscribe: () => void;
}

interface LeaseItem {
  readonly authority: QueueItemAuthority;
  phase: "activating" | "active";
}

interface LeaseRecord {
  readonly generation: number;
  readonly queueId: string;
  readonly signal: AbortSignal;
  readonly onOutcome: (outcome: LeasedPlayerOutcome) => void;
  accepting: boolean;
  volume: number;
  filters: readonly import("../contracts").FilterEntry[];
  item?: LeaseItem;
  playerGeneration?: number;
  closePromise?: Promise<void>;
  abortListener?: () => void;
}

/**
 * One guild's voice presence.
 *
 * Voice owns the session, Player generations, and the only queue lease. GuildQueue owns queue state,
 * item decisions, events, and source resources.
 */
export class VoiceImpl implements QueueVoice {
  readonly #facade: Voice;
  readonly #session: VoiceSession;
  readonly #engine: Engine;
  readonly #onTerminal: (error?: Error) => void;
  readonly #requestMove: (channelId: string) => Promise<void>;
  readonly #report: (error: Error, stage: string) => void;
  readonly #sessionUnsubscribe: () => void;
  readonly #work = new TrackedWork();
  /** Retired backend completions remain terminal work even after their ordinary queue slot settles. */
  readonly #retirements: Promise<void>[] = [];
  #phase: VoicePhase = "open";
  #channelId: string;
  #playerTail: Promise<void> = Promise.resolve();
  #playerGeneration = 0;
  #leaseGeneration = 0;
  #player?: PlayerRecord;
  #creation?: Promise<PlayerRecord>;
  #lease?: LeaseRecord;
  #releasePromise?: Promise<void>;

  /** @internal */
  constructor(
    session: VoiceSession,
    engine: Engine,
    generation: number,
    onTerminal: (error?: Error) => void,
    requestMove: (channelId: string) => Promise<void>,
    report: (error: Error, stage: string) => void,
  ) {
    this.#session = session;
    this.#channelId = session.channelId;
    this.#engine = engine;
    this.generation = generation;
    this.#onTerminal = onTerminal;
    this.#requestMove = requestMove;
    this.#report = report;
    this.#sessionUnsubscribe = session.subscribe(event => this.#onSessionEvent(event));
    const self = this;
    const facade = {
      get guildId(): string {
        return self.guildId;
      },
      get channelId(): string {
        return self.channelId;
      },
      join: (channelId: string): Promise<void> => self.#requestMove(channelId),
    };
    Object.freeze(facade);
    this.#facade = facade;
  }

  readonly generation: number;

  /** Package-private public view; the implementation never crosses the package boundary. */
  get facade(): Voice {
    return this.#facade;
  }

  get guildId(): string {
    return this.#session.guildId;
  }

  get channelId(): string {
    return this.#channelId;
  }

  get released(): boolean {
    return this.#phase === "released";
  }

  /** Moves the session only after VoiceManager admits this operation to its slot lane. */
  async move(channelId: string): Promise<void> {
    this.#assertOpen();
    if (this.#channelId === channelId) return;
    try {
      await this.#session.join(channelId);
      this.#channelId = channelId;
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to move the voice session", error);
    }
  }

  acquireQueue(request: QueueLeaseRequest): Promise<QueueVoiceLease> {
    if (this.#phase !== "open") return Promise.reject(this.#terminal());
    if (request.signal.aborted) return Promise.reject(this.#stale());
    return this.#work.start(async () => {
      const prior = this.#lease;
      if (prior) {
        if (!prior.closePromise) throw new DisTubeError(ErrorCode.QUEUE_FAILED, "Voice is already leased to a queue");
        await prior.closePromise.catch(() => undefined);
      }
      this.#assertOpen();
      if (request.signal.aborted) throw this.#stale();

      // Player creation is ordered through the Voice lane and remains owned by Voice if this request is cancelled.
      const player = await this.#ensurePlayer();
      this.#assertOpen();
      if (request.signal.aborted) throw this.#stale();

      const lease: LeaseRecord = {
        generation: ++this.#leaseGeneration,
        queueId: request.queueId,
        signal: request.signal,
        onOutcome: request.onOutcome,
        accepting: true,
        volume: 100,
        filters: Object.freeze([]),
        // The queue's acquisition effects establish the first Player state. Restoration is only for a
        // replacement Player after a terminal outcome during this lease.
        playerGeneration: player.generation,
      };
      const abortListener = (): void => {
        void this.#closeLease(lease).catch(() => undefined);
      };
      lease.abortListener = abortListener;
      request.signal.addEventListener("abort", abortListener, { once: true });
      this.#lease = lease;
      if (request.signal.aborted) abortListener();
      return this.#leaseFacade(lease);
    });
  }

  /** Fences queue effects immediately. Session release is owned by the terminal caller. */
  fence(): void {
    if (this.#phase !== "open") return;
    this.#phase = "fenced";
    const lease = this.#lease;
    if (lease) void this.#closeLease(lease).catch(() => undefined);
  }

  /** Releases the session after every already-accepted Player operation and late Player creation settle. */
  release(): Promise<void> {
    this.#releasePromise ??= this.#performRelease();
    return this.#releasePromise;
  }

  async #performRelease(): Promise<void> {
    this.fence();
    const playerTail = this.#playerTail;
    let terminalFailure: DisTubeError | undefined;
    this.#work.start(async () => {
      await playerTail;
      const player = this.#takeCurrentPlayer();
      if (player) this.#rememberRetirement(this.#callPlayerRelease(player));
      const failures = await this.#joinRetirements();
      try {
        await this.#session.release();
      } catch (error: unknown) {
        failures.push(asError(error));
      } finally {
        this.#sessionUnsubscribe();
      }
      terminalFailure = cleanupFailure(
        ErrorCode.VOICE_FAILED,
        "Voice cleanup failed",
        failures,
        "Voice terminal cleanup failures",
      );
    });
    const failures = await this.#work.settle();
    this.#phase = "released";
    if (terminalFailure && failures.length === 0) throw terminalFailure;
    const failure = cleanupFailure(
      ErrorCode.VOICE_FAILED,
      "Voice cleanup failed",
      [...(terminalFailure ? [terminalFailure] : []), ...failures],
      "Voice cleanup failures",
    );
    if (failure) throw failure;
  }

  #leaseFacade(lease: LeaseRecord): QueueVoiceLease {
    return Object.freeze({
      get generation(): number {
        return lease.generation;
      },
      position: (authority: QueueItemAuthority): number => this.#position(lease, authority),
      run: (effect: QueuePlayerEffect): Promise<void> => this.#runLeaseEffect(lease, effect),
      close: (): Promise<void> => this.#closeLease(lease),
    });
  }

  #position(lease: LeaseRecord, authority: QueueItemAuthority): number {
    if (!lease.accepting || !this.#matchesItem(lease, authority)) return 0;
    return this.#player?.player.position ?? 0;
  }

  #runLeaseEffect(lease: LeaseRecord, effect: QueuePlayerEffect): Promise<void> {
    try {
      this.#assertLease(lease);
      this.#validateEffect(lease, effect);
    } catch (error: unknown) {
      return Promise.reject(error);
    }

    const player = this.#ensurePlayer();
    const result = this.#enqueue(async () => {
      this.#assertLease(lease);
      this.#assertEffectAuthority(lease, effect);
      const record = await player;
      this.#assertLease(lease);
      this.#assertEffectAuthority(lease, effect);
      if (this.#player !== record) throw this.#stale();
      await this.#restoreLeasePlayer(lease, record);

      switch (effect.kind) {
        case "play":
          await this.#play(lease, record, effect);
          return;
        case "stop":
          await this.#stop(lease, record, effect.authority);
          return;
        case "pause":
          await record.player.pause();
          return;
        case "resume":
          await record.player.resume();
          return;
        case "seek":
          await record.player.seek(effect.seconds);
          return;
        case "volume":
          await record.player.setVolume(effect.percent);
          lease.volume = effect.percent;
          return;
        case "filters":
          await record.player.setFilters(effect.entries);
          lease.filters = Object.freeze([...effect.entries]);
          return;
      }
    });
    return result.catch(error => {
      if (effect.kind === "play" && this.#matchesItem(lease, effect.authority)) lease.item = undefined;
      throw error;
    });
  }

  #validateEffect(lease: LeaseRecord, effect: QueuePlayerEffect): void {
    if (effect.kind === "play") {
      if (effect.authority.queueId !== lease.queueId || lease.item) throw this.#stale();
      lease.item = { authority: effect.authority, phase: "activating" };
      return;
    }
    this.#assertEffectAuthority(lease, effect);
  }

  /** Recheck queued item work at execution so a retired authority cannot reach the Player. */
  #assertEffectAuthority(lease: LeaseRecord, effect: QueuePlayerEffect): void {
    if (effect.kind === "volume" || effect.kind === "filters") return;
    if (!this.#matchesItem(lease, effect.authority)) throw this.#stale();
  }

  async #restoreLeasePlayer(lease: LeaseRecord, record: PlayerRecord): Promise<void> {
    if (lease.playerGeneration === record.generation) return;
    await record.player.setVolume(lease.volume);
    await record.player.setFilters(lease.filters);
    lease.playerGeneration = record.generation;
  }

  async #play(
    lease: LeaseRecord,
    record: PlayerRecord,
    effect: Extract<QueuePlayerEffect, { kind: "play" }>,
  ): Promise<void> {
    if (!this.#matchesItem(lease, effect.authority)) throw this.#stale();
    try {
      await record.player.play(effect.request);
      const item = lease.item;
      if (item && this.#matchesItem(lease, effect.authority)) item.phase = "active";
    } catch (error: unknown) {
      const failures: Error[] = [asError(error)];
      try {
        await record.player.stopTrack();
      } catch (cleanup: unknown) {
        failures.push(asError(cleanup));
      }
      if (this.#matchesItem(lease, effect.authority)) lease.item = undefined;
      if (failures.length === 1) throw failures[0];
      throw new AggregateError(failures, "Player play rejection cleanup failed");
    }
  }

  async #stop(lease: LeaseRecord, record: PlayerRecord, authority: QueueItemAuthority): Promise<void> {
    if (!this.#matchesItem(lease, authority)) throw this.#stale();
    // A native finish emitted by stop must fail the authority check before it reaches GuildQueue.
    lease.item = undefined;
    await record.player.stopTrack();
  }

  #closeLease(lease: LeaseRecord): Promise<void> {
    if (lease.closePromise) return lease.closePromise;
    lease.accepting = false;
    if (lease.abortListener) lease.signal.removeEventListener("abort", lease.abortListener);

    const close = this.#enqueue(async () => {
      const failures: Error[] = [];
      const record = this.#player;
      if (record && this.#lease === lease) {
        if (lease.item) {
          try {
            await record.player.stopTrack();
          } catch (error: unknown) {
            failures.push(asError(error));
          }
        }
        lease.item = undefined;
        try {
          await record.player.setFilters([]);
        } catch (error: unknown) {
          failures.push(asError(error));
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Queue lease cleanup failures");
    });
    lease.closePromise = close.finally(() => {
      lease.item = undefined;
      if (this.#lease === lease) this.#lease = undefined;
    });
    void lease.closePromise.catch(() => undefined);
    return lease.closePromise;
  }

  #ensurePlayer(): Promise<PlayerRecord> {
    if (this.#player) return Promise.resolve(this.#player);
    this.#creation ??= this.#enqueue(async () => {
      try {
        const player = await this.#engine.createPlayer(this.#session);
        let unsubscribe = (): void => undefined;
        const record: PlayerRecord = {
          generation: ++this.#playerGeneration,
          player,
          unsubscribe: (): void => unsubscribe(),
        };
        unsubscribe = player.subscribe(event => this.#acceptPlayerOutcome(record, event));
        this.#player = record;
        return record;
      } catch (error: unknown) {
        throw asDisTubeError(ErrorCode.VOICE_FAILED, "Engine failed to create Player", error);
      }
    });
    const creation = this.#creation;
    void creation
      .finally(() => {
        if (this.#creation === creation) this.#creation = undefined;
      })
      .catch(() => undefined);
    return creation;
  }

  #acceptPlayerOutcome(record: PlayerRecord, event: import("../contracts").PlayerEvent): void {
    if (this.#phase !== "open" || this.#player !== record) return;
    const lease = this.#lease;
    const item = lease?.item;
    const active =
      lease?.accepting === true &&
      lease.playerGeneration === record.generation &&
      item !== undefined &&
      this.#lease === lease;

    if (!active || !lease || !item) {
      if (event.type === "failed" && event.terminal === true) this.#retireCurrentPlayer(record);
      return;
    }

    if (event.type === "failed" && event.terminal === true) {
      // Check the live lease before retiring this backend. A stale terminal event must not silently
      // strand the current item on a Player that can no longer accept effects.
      const outcome =
        item.authority.itemId === event.itemId
          ? event
          : {
              type: "failed" as const,
              itemId: item.authority.itemId,
              error: new AggregateError([event.error], "Player emitted a terminal outcome for a different active item"),
              terminal: true as const,
            };
      this.#retireCurrentPlayer(record);
      this.#publishPlayerOutcome(record, lease, item, outcome);
      return;
    }

    if (item.authority.itemId !== event.itemId) return;
    this.#publishPlayerOutcome(record, lease, item, event);
  }

  #publishPlayerOutcome(
    record: PlayerRecord,
    lease: LeaseRecord,
    item: LeaseItem,
    event: import("../contracts").PlayerEvent,
  ): void {
    void this.#enqueue(async () => {
      if (
        this.#phase !== "open" ||
        !lease.accepting ||
        this.#lease !== lease ||
        lease.playerGeneration !== record.generation ||
        lease.item !== item
      ) {
        return;
      }
      const authority = item.authority;
      lease.item = undefined;
      lease.onOutcome(
        Object.freeze({ authority: Object.freeze({ ...authority, leaseGeneration: lease.generation }), event }),
      );
    }).catch(error => this.#report(asError(error), "voice.player.outcome"));
  }

  #onSessionEvent(event: VoiceSessionEvent): void {
    if (event.type === "disconnected") {
      if (this.#phase !== "open") return;
      this.fence();
      this.#onTerminal(event.error);
      return;
    }
    if (this.#phase !== "open") return;
    this.#channelId = event.channelId;
    this.#refreshGateway(event.gateway);
  }

  #refreshGateway(gateway: VoiceGatewayData): void {
    const record = this.#player;
    if (this.#phase !== "open" || !record?.player.updateVoiceGateway) return;
    void this.#enqueue(async () => {
      if (this.#phase !== "open" || this.#player !== record || !record.player.updateVoiceGateway) return;
      await record.player.updateVoiceGateway(gateway);
    }).catch(error => this.#report(asError(error), "voice.gateway.refresh"));
  }

  #retireCurrentPlayer(record: PlayerRecord): void {
    const retiring = this.#takeCurrentPlayer(record);
    if (!retiring) return;
    this.#rememberRetirement(this.#queuePlayerRelease(retiring));
  }

  /** Queues retirement behind already-accepted backend effects without letting ordinary work discard it. */
  #queuePlayerRelease(record: PlayerRecord): Promise<void> {
    const result = this.#playerTail.then(() => record.player.release());
    this.#playerTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #callPlayerRelease(record: PlayerRecord): Promise<void> {
    try {
      return Promise.resolve(record.player.release());
    } catch (error: unknown) {
      return Promise.reject(asError(error));
    }
  }

  #rememberRetirement(completion: Promise<void>): void {
    this.#retirements.push(completion);
    void completion.catch(error => this.#report(asError(error), "voice.player.release"));
  }

  #joinRetirements(): Promise<Error[]> {
    let cursor = 0;
    return settleGrowing(() => {
      const completions = this.#retirements.slice(cursor);
      cursor += completions.length;
      return completions;
    });
  }

  #takeCurrentPlayer(expected?: PlayerRecord): PlayerRecord | undefined {
    const record = this.#player;
    if (!record || (expected && record !== expected)) return undefined;
    record.unsubscribe();
    this.#player = undefined;
    return record;
  }

  #enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    return this.#work.start(() => {
      const result = this.#playerTail.then(operation);
      this.#playerTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });
  }

  #matchesItem(lease: LeaseRecord, authority: QueueItemAuthority): boolean {
    const item = lease.item;
    return (
      this.#lease === lease &&
      item !== undefined &&
      item.authority.queueId === authority.queueId &&
      item.authority.attemptGeneration === authority.attemptGeneration &&
      item.authority.itemId === authority.itemId
    );
  }

  #assertLease(lease: LeaseRecord): void {
    if (this.#phase !== "open" || !lease.accepting || this.#lease !== lease || lease.signal.aborted) {
      throw this.#stale();
    }
  }

  #assertOpen(): void {
    if (this.#phase !== "open") throw this.#terminal();
  }

  #stale(): DisTubeError {
    return new DisTubeError(ErrorCode.QUEUE_FAILED, "Queue lease is no longer active");
  }

  #terminal(): DisTubeError {
    return new DisTubeError(ErrorCode.VOICE_FAILED, "Voice is no longer connected");
  }
}
