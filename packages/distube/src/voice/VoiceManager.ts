import type { Adapter, Engine, JoinOptions, VoiceSession, VoiceTarget } from "../contracts";
import { abortFailure, asDisTubeError, asError, DisTubeError, ErrorCode } from "../errors";
import type { DisTubeEventEmitter, VoiceDisconnectReason } from "../events";
import { cleanupFailure } from "../queue/failures";
import type { QueueTerminalCause } from "../queue/terminal";
import { settleAll } from "../utils/dispose";
import { type DisTubeVoice, VoiceImpl } from "./DisTubeVoice";
import { normalizeTarget, type VoiceChannelTarget, validateTarget } from "./target";

/** Options for `distube.voices.join`. Defaults are self-deaf on and self-mute off. */
export type VoiceJoinOptions = JoinOptions & { readonly signal?: AbortSignal };

/** Readonly view over the connected Voices, published as `distube.voices`. */
export type VoiceCollection<Target = VoiceChannelTarget> = Readonly<{
  readonly size: number;
  [Symbol.iterator](): IterableIterator<DisTubeVoice<Target>>;
}>;

/** Public voice manager facade. */
export type VoiceManager<Target = VoiceChannelTarget> = VoiceCollection<Target> & {
  join(target: Target, options?: VoiceJoinOptions): Promise<DisTubeVoice<Target>>;
  get(guildId: string): DisTubeVoice<Target> | undefined;
  has(guildId: string): boolean;
  leave(guildId: string): Promise<void>;
};

/** Hooks the VoiceManager<Target> needs from the client without depending on the queue registry. */
export interface VoiceManagerContext<Target = VoiceChannelTarget> {
  readonly events: DisTubeEventEmitter<Target>;
  order<Value>(guildId: string, work: () => Promise<Value>): Promise<Value>;
  /** Deletes the guild's live or provisional queue before the connection goes away. */
  deleteQueue(guildId: string, cause: QueueTerminalCause): Promise<void>;
  /** Publishes the guild's terminal disconnect, once, after its queue deletion. */
  onDisconnected(voice: DisTubeVoice<Target>, reason: VoiceDisconnectReason, error?: Error): void;
}

/** The voice state core joins with unless the caller overrides it. */
export const DEFAULT_VOICE_STATE: Readonly<Required<JoinOptions>> = Object.freeze({
  selfDeaf: true,
  selfMute: false,
});

type SlotPhase = "open" | "shutdown-fenced" | "terminating" | "closed";

interface SlotTerminal {
  readonly reason: VoiceDisconnectReason;
  readonly error?: Error;
  readonly completion: Promise<void>;
}

interface VoiceSlot<Target = VoiceChannelTarget> {
  readonly guildId: string;
  readonly generation: number;
  phase: SlotPhase;
  /** Set as soon as Adapter creation succeeds, before DisTubeVoice construction can fail. */
  session?: VoiceSession;
  /** One raw-session cleanup for a DisTubeVoice that could not be constructed. */
  sessionRelease?: Promise<void>;
  voice?: VoiceImpl<Target>;
  creation?: Promise<VoiceImpl<Target>>;
  movementTail: Promise<void>;
  pendingOperations: number;
  terminal?: SlotTerminal;
  /** The first accepted terminal reason, including shutdown fencing before release begins. */
  terminalReason?: Readonly<{ reason: VoiceDisconnectReason; error?: Error }>;
  creationFailed?: boolean;
  shutdownError?: DisTubeError;
}

/**
 * Guild DisTubeVoice presence with one private slot per guild.
 *
 * A slot starts synchronously with session creation and remains in the map until all terminal work,
 * including late session creation, settles. Public reads expose only open slots with a live DisTubeVoice.
 */
export class VoiceManagerImpl<Target = VoiceChannelTarget> implements VoiceManager<Target> {
  readonly #facade: VoiceManager<Target>;
  readonly #adapter: Adapter<Target>;
  readonly #engine: Engine;
  readonly #context: VoiceManagerContext<Target>;
  readonly #slots = new Map<string, VoiceSlot<Target>>();
  readonly #epochs = new Map<string, number>();
  #nextGeneration = 0;
  #fenced = false;

  /** @internal */
  constructor(adapter: Adapter<Target>, engine: Engine, context: VoiceManagerContext<Target>) {
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
  get facade(): VoiceManager<Target> {
    return this.#facade;
  }

  get size(): number {
    let size = 0;
    for (const slot of this.#slots.values()) if (slot.phase === "open" && slot.voice) size += 1;
    return size;
  }

  *[Symbol.iterator](): IterableIterator<DisTubeVoice<Target>> {
    for (const slot of this.#slots.values()) {
      if (slot.phase === "open" && slot.voice) yield slot.voice.facade;
    }
  }

  async join(channel: Target, options: VoiceJoinOptions = {}): Promise<DisTubeVoice<Target>> {
    this.#assertReady();
    const target = this.#normalizeTarget(channel);
    const state = validateJoinOptions(options);
    if (options.signal?.aborted) throw abortFailure(options.signal.reason);
    this.assertJoinable(target.guildId);
    const epoch = this.#epochs.get(target.guildId) ?? 0;
    return this.#context.order(target.guildId, async () => {
      if (options.signal?.aborted) throw abortFailure(options.signal.reason);
      if ((this.#epochs.get(target.guildId) ?? 0) !== epoch) throw this.#staleSlot();
      const slot = this.#joinSlot(target, state);
      const voice = await this.#enqueueMovement(slot, target.channelId);
      if (options.signal?.aborted) throw abortFailure(options.signal.reason);
      return voice.facade;
    });
  }

  /** Package-private movement used by QueueManager before it returns its own facade. */
  joinInternal(target: VoiceTarget): Promise<VoiceImpl<Target>> {
    const slot = this.#joinSlot(target, DEFAULT_VOICE_STATE);
    return this.#enqueueMovement(slot, target.channelId);
  }

  #joinSlot(target: VoiceTarget, state: Required<JoinOptions>): VoiceSlot<Target> {
    this.#assertReady();
    validateTarget(target);
    this.assertJoinable(target.guildId);
    return this.#slots.get(target.guildId) ?? this.#createSlot(target, state);
  }

  /** Rejects work accepted while a guild DisTubeVoice is terminalizing, even if it would join after slot closure. */
  assertJoinable(guildId: string): void {
    this.#assertReady();
    const slot = this.#slots.get(guildId);
    if (slot && slot.phase !== "open") throw slot.shutdownError ?? this.#staleSlot();
  }

  /** Package-private lookup used by QueueManager to attach a queue to the live DisTubeVoice. */
  getInternal(guildId: string): VoiceImpl<Target> | undefined {
    const slot = this.#slots.get(guildId);
    return slot?.phase === "open" ? slot.voice : undefined;
  }

  get(guildId: string): DisTubeVoice<Target> | undefined {
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
    this.#epochs.set(guildId, (this.#epochs.get(guildId) ?? 0) + 1);
    if (!slot) return this.#context.deleteQueue(guildId, { kind: "leave" });
    return this.#acceptTerminal(slot, "left", undefined, { kind: "leave" });
  }

  /** `voice.leave()`: the same terminal path, bound to the facade's own slot so an old handle cannot leave a successor. */
  #leaveFacade(slot: VoiceSlot<Target>): Promise<void> {
    if (slot.terminal) return slot.terminal.completion;
    if (this.#slots.get(slot.guildId) !== slot || slot.phase === "closed") return Promise.resolve();
    return this.leave(slot.guildId);
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

  #createSlot(target: VoiceTarget, state: Required<JoinOptions>): VoiceSlot<Target> {
    const slot: VoiceSlot<Target> = {
      guildId: target.guildId,
      generation: ++this.#nextGeneration,
      phase: "open",
      movementTail: Promise.resolve(),
      pendingOperations: 0,
    };
    this.#slots.set(slot.guildId, slot);
    const creation = this.#createVoice(slot, target, state);
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

  async #createVoice(
    slot: VoiceSlot<Target>,
    target: VoiceTarget,
    state: Required<JoinOptions>,
  ): Promise<VoiceImpl<Target>> {
    let session: VoiceSession;
    try {
      session = await this.#adapter.createVoiceSession(target, state);
    } catch (error: unknown) {
      throw asDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to create the voice session", error);
    }
    slot.session = session;

    try {
      const voice = new VoiceImpl(
        session,
        this.#engine,
        this.#context.events,
        error => this.#onSessionTerminal(slot, error),
        channelId => this.#moveFacade(slot, channelId),
        () => this.#leaveFacade(slot),
        (error, stage) =>
          this.#context.events.report({
            severity: "error",
            stage,
            message: `DisTubeVoice ${slot.guildId} background operation failed`,
            error,
            detail: Object.freeze({ guildId: slot.guildId, slotGeneration: slot.generation }),
          }),
        target => this.#normalizeTarget(target),
      );
      slot.voice = voice;
      if (slot.phase !== "open") voice.fence();
      return voice;
    } catch (error: unknown) {
      const constructionFailure = asDisTubeError(ErrorCode.VOICE_FAILED, "DisTubeVoice construction failed", error);
      try {
        await this.#releaseRawSession(slot);
      } catch (releaseError: unknown) {
        throw new DisTubeError(ErrorCode.VOICE_FAILED, "DisTubeVoice construction cleanup failed", {
          cause: new AggregateError(
            [constructionFailure, asError(releaseError)],
            "DisTubeVoice construction cleanup failures",
          ),
        });
      }
      throw constructionFailure;
    }
  }

  #moveFacade(slot: VoiceSlot<Target>, channelId: string): Promise<void> {
    if (this.#slots.get(slot.guildId) !== slot || slot.phase !== "open" || !slot.voice) {
      return Promise.reject(this.#staleSlot());
    }
    return this.#context.order(slot.guildId, () => this.#enqueueMovement(slot, channelId)).then(() => undefined);
  }

  #enqueueMovement(slot: VoiceSlot<Target>, channelId: string): Promise<VoiceImpl<Target>> {
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
    slot: VoiceSlot<Target>,
    reason: VoiceDisconnectReason,
    error: Error | undefined,
    cause: QueueTerminalCause,
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
    slot.voice?.fence(error);

    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    slot.terminal = { reason, ...(error ? { error } : {}), completion };

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

  async #finishTerminal(slot: VoiceSlot<Target>, deletion: Promise<void>): Promise<void> {
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

    if (slot.voice) this.#context.onDisconnected(slot.voice.facade, terminal.reason, terminal.error);
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
      "DisTubeVoice terminal cleanup failed",
      failures,
      "DisTubeVoice terminal cleanup failures",
    );
    if (failure) throw failure;
  }

  /** Releases a session whose DisTubeVoice facade could not be constructed, sharing cleanup with terminal callers. */
  #releaseRawSession(slot: VoiceSlot<Target>): Promise<void> {
    const session = slot.session;
    if (!session) return Promise.resolve();
    slot.sessionRelease ??= Promise.resolve()
      .then(() => session.release())
      .catch((error: unknown) => {
        throw asDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to release the voice session", error);
      });
    return slot.sessionRelease;
  }

  #onSessionTerminal(slot: VoiceSlot<Target>, error?: Error): void {
    if (this.#slots.get(slot.guildId) !== slot || slot.phase === "closed" || slot.terminal) return;
    const completion = this.#acceptTerminal(slot, "platform", error, {
      kind: "voice-loss",
      ...(error ? { error } : {}),
    });
    void completion.catch(cause => {
      this.#context.events.report({
        severity: "error",
        stage: "voice.disconnect",
        message: "DisTubeVoice cleanup failed after a platform disconnect",
        error: asError(cause),
        detail: Object.freeze({ guildId: slot.guildId, slotGeneration: slot.generation }),
      });
    });
  }

  #closeSlot(slot: VoiceSlot<Target>): void {
    if (this.#slots.get(slot.guildId) !== slot) return;
    slot.phase = "closed";
    this.#slots.delete(slot.guildId);
  }

  #discardFailedSlot(slot: VoiceSlot<Target>): void {
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

  #normalizeTarget(target: Target): VoiceTarget {
    return normalizeTarget(this.#adapter, target);
  }

  #assertReady(): void {
    if (this.#fenced) throw this.#shutdownError();
  }

  #shutdownError(): DisTubeError {
    return new DisTubeError("INVALID_STATE", "DisTube is disposed");
  }

  #staleSlot(): DisTubeError {
    return new DisTubeError("INVALID_STATE", "DisTubeVoice operation was superseded");
  }
}

function validateJoinOptions(options: VoiceJoinOptions): Required<JoinOptions> {
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some(key => !["selfDeaf", "selfMute", "signal"].includes(key)) ||
    (options.selfDeaf !== undefined && typeof options.selfDeaf !== "boolean") ||
    (options.selfMute !== undefined && typeof options.selfMute !== "boolean") ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal))
  ) {
    throw new DisTubeError("INVALID_ARGUMENT", "Invalid join options");
  }
  return Object.freeze({
    selfDeaf: options.selfDeaf ?? DEFAULT_VOICE_STATE.selfDeaf,
    selfMute: options.selfMute ?? DEFAULT_VOICE_STATE.selfMute,
  });
}
