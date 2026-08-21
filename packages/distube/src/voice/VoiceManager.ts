import type { Adapter, Diagnostic, Engine, VoiceSession, VoiceTarget } from "../contracts";
import { asDisTubeError, DisTubeError, ErrorCode } from "../errors";
import type { VoiceDisconnectReason } from "../events";
import { cleanupFailure } from "../queue/failures";
import type { QueueTerminalCause } from "../queue/terminal";
import type { QueueVoice } from "../queue/voice";
import { settleAll } from "../utils/dispose";
import { type Voice, VoiceImpl } from "./Voice";

/** Readonly view over the connected Voices, published as `distube.voices`. */
export type VoiceCollection = Readonly<{
  readonly size: number;
  [Symbol.iterator](): IterableIterator<Voice>;
}>;

/** Public voice manager facade. */
export type VoiceManager = VoiceCollection & {
  join(target: VoiceTarget): Promise<Voice>;
  get(guildId: string): Voice | undefined;
  has(guildId: string): boolean;
  leave(guildId: string): Promise<void>;
};

/** Hooks the VoiceManager needs from the client without depending on the queue registry. */
export interface VoiceManagerContext {
  /** Deletes the guild's live or provisional queue before the connection goes away. */
  deleteQueue(guildId: string, cause: QueueTerminalCause): Promise<void>;
  /** Publishes the guild's terminal disconnect, once, after its queue deletion. */
  onDisconnected(voice: Voice, reason: VoiceDisconnectReason, error?: Error): void;
  /** Reports a failure that has no pending terminal caller to reject. */
  report(diagnostic: Diagnostic): void;
}

type SlotPhase = "open" | "shutdown-fenced" | "terminating" | "closed";

interface SlotTerminal {
  readonly reason: VoiceDisconnectReason;
  readonly error?: Error;
  readonly completion: Promise<void>;
  readonly announce: boolean;
}

interface VoiceSlot {
  readonly guildId: string;
  readonly generation: number;
  phase: SlotPhase;
  /** Set as soon as Adapter creation succeeds, before Voice construction can fail. */
  session?: VoiceSession;
  /** One raw-session cleanup for a Voice that could not be constructed. */
  sessionRelease?: Promise<void>;
  voice?: VoiceImpl;
  creation?: Promise<VoiceImpl>;
  movementTail: Promise<void>;
  pendingOperations: number;
  terminal?: SlotTerminal;
  /** The first accepted terminal reason, including shutdown fencing before release begins. */
  terminalReason?: Readonly<{ reason: VoiceDisconnectReason; error?: Error }>;
  creationFailed?: boolean;
  shutdownError?: DisTubeError;
}

/**
 * Guild Voice presence with one private slot per guild.
 *
 * A slot starts synchronously with session creation and remains in the map until all terminal work,
 * including late session creation, settles. Public reads expose only open slots with a live Voice.
 */
export class VoiceManagerImpl implements VoiceManager {
  readonly #facade: VoiceManager;
  readonly #adapter: Adapter;
  readonly #engine: Engine;
  readonly #context: VoiceManagerContext;
  readonly #slots = new Map<string, VoiceSlot>();
  #nextGeneration = 0;
  #fenced = false;

  /** @internal */
  constructor(adapter: Adapter, engine: Engine, context: VoiceManagerContext) {
    this.#adapter = adapter;
    this.#engine = engine;
    this.#context = context;
    const self = this;
    const facade = {
      get size(): number {
        return self.size;
      },
      join: self.join.bind(self),
      get: self.get.bind(self),
      has: self.has.bind(self),
      leave: self.leave.bind(self),
      [Symbol.iterator]: self[Symbol.iterator].bind(self),
    };
    Object.freeze(facade);
    this.#facade = facade;
  }

  /** Package-private public view; the implementation never crosses the package boundary. */
  get facade(): VoiceManager {
    return this.#facade;
  }

  get size(): number {
    let size = 0;
    for (const slot of this.#slots.values()) if (slot.phase === "open" && slot.voice) size += 1;
    return size;
  }

  *[Symbol.iterator](): IterableIterator<Voice> {
    for (const slot of this.#slots.values()) {
      if (slot.phase === "open" && slot.voice) yield slot.voice.facade;
    }
  }

  async join(target: VoiceTarget): Promise<Voice> {
    return (await this.joinInternal(target)).facade;
  }

  /** Package-private movement used by QueueManager before it returns its own facade. */
  joinInternal(target: VoiceTarget): Promise<VoiceImpl> {
    this.#assertReady();
    validateTarget(target);
    this.assertJoinable(target.guildId);
    const slot = this.#slots.get(target.guildId) ?? this.#createSlot(target);
    return this.#enqueueMovement(slot, target.channelId);
  }

  /** Rejects work accepted while a guild Voice is terminalizing, even if it would join after slot closure. */
  assertJoinable(guildId: string): void {
    this.#assertReady();
    const slot = this.#slots.get(guildId);
    if (slot && slot.phase !== "open") throw slot.shutdownError ?? this.#staleSlot();
  }

  /** Package-private lookup used by QueueManager to bind the exact Voice generation to a queue. */
  getInternal(guildId: string): QueueVoice | undefined {
    const slot = this.#slots.get(guildId);
    return slot?.phase === "open" ? slot.voice : undefined;
  }

  get(guildId: string): Voice | undefined {
    const slot = this.#slots.get(guildId);
    return slot?.phase === "open" ? slot.voice?.facade : undefined;
  }

  has(guildId: string): boolean {
    return this.get(guildId) !== undefined;
  }

  /** Deletes the guild queue first, then releases its session and publishes one disconnect event. */
  leave(guildId: string): Promise<void> {
    this.#assertReady();
    const slot = this.#slots.get(guildId);
    if (!slot) return Promise.resolve();
    return this.#acceptTerminal(slot, "left", undefined, { kind: "leave" });
  }

  /** Rejects new movement and hides every open slot without prematurely dropping terminal ownership. */
  fence(): void {
    if (this.#fenced) return;
    this.#fenced = true;
    for (const slot of this.#slots.values()) {
      if (slot.phase !== "open") continue;
      slot.phase = "shutdown-fenced";
      slot.shutdownError = this.#shutdownError();
      slot.terminalReason = Object.freeze({ reason: "shutdown" });
      slot.voice?.fence();
    }
  }

  /** Completes every shutdown-fenced slot in generation order. */
  releaseAll(): Promise<readonly Error[]> {
    const slots = [...this.#slots.values()].sort((left, right) => left.generation - right.generation);
    const completions = slots.map(slot => {
      if (slot.terminal) return slot.terminal.completion;
      return this.#acceptTerminal(slot, "shutdown", undefined, { kind: "shutdown" });
    });
    return settleAll(completions.map(completion => () => completion));
  }

  /** Releases a Voice created solely by a rejected first-play transaction without announcing a public disconnect. */
  releaseOwned(voice: QueueVoice): Promise<void> {
    const slot = this.#slots.get(voice.guildId);
    if (!slot || slot.generation !== voice.generation || slot.voice !== voice || slot.phase !== "open") {
      return Promise.resolve();
    }
    return this.#acceptTerminal(slot, "left", undefined, { kind: "rollback" }, false);
  }

  #createSlot(target: VoiceTarget): VoiceSlot {
    const slot: VoiceSlot = {
      guildId: target.guildId,
      generation: ++this.#nextGeneration,
      phase: "open",
      movementTail: Promise.resolve(),
      pendingOperations: 0,
    };
    this.#slots.set(slot.guildId, slot);
    const creation = this.#createVoice(slot, target);
    slot.creation = creation;
    void creation
      .then(
        () => undefined,
        () => {
          slot.creationFailed = true;
        },
      )
      .finally(() => this.#discardFailedSlot(slot))
      .catch(() => undefined);
    return slot;
  }

  async #createVoice(slot: VoiceSlot, target: VoiceTarget): Promise<VoiceImpl> {
    let session: VoiceSession;
    try {
      session = await this.#adapter.createVoiceSession(target);
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to create the voice session", error);
    }
    slot.session = session;

    try {
      const voice = new VoiceImpl(
        session,
        this.#engine,
        slot.generation,
        error => this.#onSessionTerminal(slot, error),
        channelId => this.#moveFacade(slot, channelId),
        (error, stage) =>
          this.#context.report({
            severity: "error",
            stage,
            message: `Voice ${slot.guildId} background operation failed`,
            error,
            detail: Object.freeze({ guildId: slot.guildId, slotGeneration: slot.generation }),
          }),
      );
      slot.voice = voice;
      if (slot.phase !== "open") voice.fence();
      return voice;
    } catch (error: unknown) {
      const constructionFailure = asDisTubeError(ErrorCode.VOICE_FAILED, "Voice construction failed", error);
      try {
        await this.#releaseRawSession(slot);
      } catch (releaseError: unknown) {
        throw new DisTubeError(ErrorCode.VOICE_FAILED, "Voice construction cleanup failed", {
          cause: new AggregateError(
            [constructionFailure, asError(releaseError)],
            "Voice construction cleanup failures",
          ),
        });
      }
      throw constructionFailure;
    }
  }

  #moveFacade(slot: VoiceSlot, channelId: string): Promise<void> {
    if (this.#slots.get(slot.guildId) !== slot || slot.phase !== "open" || !slot.voice) {
      return Promise.reject(this.#staleSlot());
    }
    return this.#enqueueMovement(slot, channelId).then(() => undefined);
  }

  #enqueueMovement(slot: VoiceSlot, channelId: string): Promise<VoiceImpl> {
    if (slot.phase !== "open") return Promise.reject(slot.shutdownError ?? this.#staleSlot());
    slot.pendingOperations += 1;
    const previous = slot.movementTail;
    const creation = slot.creation;
    const operation = previous.then(async () => {
      if (slot.phase !== "open") throw slot.shutdownError ?? this.#staleSlot();
      if (!creation) throw this.#staleSlot();
      const voice = await creation;
      if (slot.phase !== "open") throw slot.shutdownError ?? this.#staleSlot();
      await voice.move(channelId);
      return voice;
    });
    slot.movementTail = operation.then(
      () => undefined,
      () => undefined,
    );
    void operation
      .finally(() => {
        slot.pendingOperations -= 1;
        this.#discardFailedSlot(slot);
      })
      .catch(() => undefined);
    return operation;
  }

  #acceptTerminal(
    slot: VoiceSlot,
    reason: VoiceDisconnectReason,
    error: Error | undefined,
    cause: QueueTerminalCause,
    announce = true,
  ): Promise<void> {
    if (slot.terminal) return slot.terminal.completion;
    if (slot.phase === "closed") return Promise.reject(this.#staleSlot());

    // Shutdown records first-terminal authority during fence, even if platform loss arrives first later.
    if (slot.phase === "shutdown-fenced") {
      reason = "shutdown";
      error = undefined;
      cause = { kind: "shutdown" };
    }
    slot.terminalReason ??= Object.freeze({ reason, ...(error ? { error } : {}) });
    reason = slot.terminalReason.reason;
    error = slot.terminalReason.error;
    slot.phase = "terminating";
    slot.voice?.fence();

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    slot.terminal = { reason, ...(error ? { error } : {}), completion, announce };

    let deletion: Promise<void>;
    try {
      // QueueManager destroys live and provisional queues synchronously before returning this Promise.
      deletion = this.#context.deleteQueue(slot.guildId, cause);
    } catch (failure: unknown) {
      deletion = Promise.reject(failure);
    }
    void this.#finishTerminal(slot, deletion).then(resolve, reject);
    void completion.finally(() => this.#closeSlot(slot)).catch(() => undefined);
    return completion;
  }

  async #finishTerminal(slot: VoiceSlot, deletion: Promise<void>): Promise<void> {
    const terminal = slot.terminal;
    if (!terminal) return;
    const failures: Error[] = [];

    // Creation failure leaves no session to clean. We still await it so a late successful session is released below.
    try {
      await slot.creation;
    } catch {
      // The join caller receives its own creation error. Terminal cleanup has no session failure to report.
    }
    try {
      await slot.movementTail;
    } catch (error: unknown) {
      failures.push(asError(error));
    }
    try {
      await deletion;
    } catch (error: unknown) {
      failures.push(asError(error));
    }
    if (slot.voice) {
      try {
        await slot.voice.release();
      } catch (error: unknown) {
        failures.push(asError(error));
      }
    } else if (slot.session) {
      try {
        await this.#releaseRawSession(slot);
      } catch (error: unknown) {
        failures.push(asError(error));
      }
    }

    if (terminal.announce && slot.voice)
      this.#context.onDisconnected(slot.voice.facade, terminal.reason, terminal.error);
    const onlyVoiceCleanupFailure = failures[0];
    if (
      failures.length === 1 &&
      onlyVoiceCleanupFailure instanceof DisTubeError &&
      onlyVoiceCleanupFailure.code === ErrorCode.VOICE_FAILED
    ) {
      throw onlyVoiceCleanupFailure;
    }
    const failure = cleanupFailure(
      ErrorCode.VOICE_FAILED,
      "Voice terminal cleanup failed",
      failures,
      "Voice terminal cleanup failures",
    );
    if (failure) throw failure;
  }

  /** Releases a session whose Voice facade could not be constructed, sharing cleanup with terminal callers. */
  #releaseRawSession(slot: VoiceSlot): Promise<void> {
    const session = slot.session;
    if (!session) return Promise.resolve();
    slot.sessionRelease ??= Promise.resolve()
      .then(() => session.release())
      .catch((error: unknown) => {
        throw asDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to release the voice session", error);
      });
    return slot.sessionRelease;
  }

  #onSessionTerminal(slot: VoiceSlot, error?: Error): void {
    if (this.#slots.get(slot.guildId) !== slot || slot.phase === "closed" || slot.terminal) return;
    const completion = this.#acceptTerminal(slot, "platform", error, {
      kind: "voice-loss",
      ...(error ? { error } : {}),
    });
    void completion.catch(cause => {
      this.#context.report({
        severity: "error",
        stage: "voice.disconnect",
        message: "Voice cleanup failed after a platform disconnect",
        error: asError(cause),
        detail: Object.freeze({ guildId: slot.guildId, slotGeneration: slot.generation }),
      });
    });
  }

  #closeSlot(slot: VoiceSlot): void {
    if (this.#slots.get(slot.guildId) !== slot) return;
    slot.phase = "closed";
    this.#slots.delete(slot.guildId);
  }

  #discardFailedSlot(slot: VoiceSlot): void {
    if (
      slot.phase === "open" &&
      slot.creationFailed &&
      slot.pendingOperations === 0 &&
      !slot.terminal &&
      this.#slots.get(slot.guildId) === slot
    ) {
      slot.phase = "closed";
      this.#slots.delete(slot.guildId);
    }
  }

  #assertReady(): void {
    if (this.#fenced) throw this.#shutdownError();
  }

  #shutdownError(): DisTubeError {
    return new DisTubeError(ErrorCode.QUEUE_FAILED, "DisTube is shutting down");
  }

  #staleSlot(): DisTubeError {
    return new DisTubeError(ErrorCode.QUEUE_FAILED, "Voice operation was superseded");
  }
}

function validateTarget(target: VoiceTarget): void {
  if (!target || typeof target.guildId !== "string" || target.guildId.length === 0) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "guildId must be a non-empty string");
  }
  if (typeof target.channelId !== "string" || target.channelId.length === 0) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "channelId must be a non-empty string");
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
