import type { Adapter, Engine } from "../contracts";
import { abortError, DisTubeError, ErrorCode, requireBoolean, throwIfAborted, toDisTubeError } from "../errors";
import type { DisTubeEvents, QueueDeleteReason, VoiceDisconnectReason } from "../events";
import { closeVoice, DisTubeVoice } from "./DisTubeVoice";
import { normalizeTarget, type VoiceChannelTarget } from "./target";

/** Options for `distube.voices.join`; an omitted flag keeps the voice's current one. */
export interface VoiceJoinOptions {
  /** Default `true`. */
  readonly selfDeaf?: boolean;
  /** Default `false`. */
  readonly selfMute?: boolean;
  readonly signal?: AbortSignal;
}

export interface VoiceManagerContext<Target> {
  readonly adapter: Adapter<Target>;
  readonly engine: Engine;
  readonly events: DisTubeEvents<Target>;
  readonly timeoutMs: number;
  readonly deleteQueue: (guildId: string, reason: QueueDeleteReason, error?: DisTubeError) => void;
}

export let closeVoices: <Target>(manager: VoiceManager<Target>) => Promise<readonly unknown[]>;

/** The connected guild voices, usable with or without a queue. */
export class VoiceManager<Target = VoiceChannelTarget> {
  readonly #context: VoiceManagerContext<Target>;
  readonly #voices = new Map<string, DisTubeVoice<Target>>();
  readonly #joins = new Map<
    string,
    { readonly waiters: (AbortSignal | undefined)[]; readonly voice: Promise<DisTubeVoice<Target>> }
  >();
  readonly #leaving = new Map<string, Promise<void>>();
  #disposed = false;

  static {
    closeVoices = manager => manager.#closeAll();
  }

  constructor(context: VoiceManagerContext<Target>) {
    this.#context = context;
  }

  get size(): number {
    return this.#voices.size;
  }

  [Symbol.iterator](): IterableIterator<DisTubeVoice<Target>> {
    return this.#voices.values();
  }

  get(guildId: string): DisTubeVoice<Target> | undefined {
    return this.#voices.get(guildId);
  }

  has(guildId: string): boolean {
    return this.#voices.has(guildId);
  }

  /** Connects to `channel`, or moves the guild's existing voice there. */
  async join(channel: Target, options: VoiceJoinOptions = {}): Promise<DisTubeVoice<Target>> {
    this.#assertLive();
    const target = normalizeTarget(this.#context.adapter, channel);
    if (options.selfDeaf !== undefined) requireBoolean(options.selfDeaf, "selfDeaf");
    if (options.selfMute !== undefined) requireBoolean(options.selfMute, "selfMute");
    throwIfAborted(options.signal);
    const voice = this.#voices.get(target.guildId) ?? (await this.#joining(target.guildId, target.channelId, options));
    await voice.move(channel);
    if (options.selfDeaf !== undefined && voice.selfDeaf !== options.selfDeaf)
      await voice.setSelfDeaf(options.selfDeaf);
    if (options.selfMute !== undefined && voice.selfMute !== options.selfMute)
      await voice.setSelfMute(options.selfMute);
    throwIfAborted(options.signal);
    return voice;
  }

  /** Deletes the guild queue, then releases its voice. Concurrent calls share one cleanup. */
  leave(guildId: string): Promise<void> {
    this.#joins.delete(guildId);
    this.#context.deleteQueue(guildId, "leave");
    const voice = this.#voices.get(guildId);
    return voice ? this.#end(voice, "left") : (this.#leaving.get(guildId) ?? Promise.resolve());
  }

  #joining(guildId: string, channelId: string, options: VoiceJoinOptions): Promise<DisTubeVoice<Target>> {
    const pending = this.#joins.get(guildId);
    if (pending) {
      pending.waiters.push(options.signal);
      return raceSignal(pending.voice, options.signal);
    }
    const waiters = [options.signal];
    const voice = this.#create(guildId, channelId, options, waiters);
    this.#joins.set(guildId, { waiters, voice });
    return raceSignal(voice, options.signal);
  }

  async #create(
    guildId: string,
    channelId: string,
    options: VoiceJoinOptions,
    waiters: readonly (AbortSignal | undefined)[],
  ): Promise<DisTubeVoice<Target>> {
    let session;
    try {
      await this.#leaving.get(guildId)?.catch(() => undefined);
      session = await this.#context.adapter.createVoiceSession(
        { guildId, channelId },
        {
          selfDeaf: options.selfDeaf ?? true,
          selfMute: options.selfMute ?? false,
          timeoutMs: this.#context.timeoutMs,
        },
      );
    } catch (error: unknown) {
      if (this.#joins.get(guildId)?.waiters === waiters) this.#joins.delete(guildId);
      throw toDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to create the voice session", error);
    }
    const superseded = this.#disposed || this.#joins.get(guildId)?.waiters !== waiters;
    if (superseded || waiters.every(signal => signal?.aborted)) {
      if (!superseded) this.#joins.delete(guildId);
      await session.release().catch((error: unknown) => this.#report("voice.session.release", error));
      if (superseded) throw new DisTubeError(ErrorCode.INVALID_STATE, "Voice join was superseded");
      throw abortError(waiters[0] as AbortSignal);
    }
    this.#joins.delete(guildId);
    let voice: DisTubeVoice<Target>;
    try {
      voice = new DisTubeVoice({
        session,
        engine: this.#context.engine,
        events: this.#context.events,
        normalizeTarget: target => normalizeTarget(this.#context.adapter, target),
        leave: () => (this.#voices.get(guildId) === voice ? this.leave(guildId) : closeVoice(voice)),
        disconnected: error => this.#disconnected(voice, error),
      });
    } catch (error: unknown) {
      await session.release().catch((cleanup: unknown) => this.#report("voice.session.release", cleanup));
      throw toDisTubeError(ErrorCode.VOICE_FAILED, "DisTubeVoice could not attach to the session", error);
    }
    this.#voices.set(guildId, voice);
    return voice;
  }

  #disconnected(voice: DisTubeVoice<Target>, cause?: Error): void {
    if (this.#voices.get(voice.guildId) !== voice) return;
    const error = new DisTubeError(ErrorCode.VOICE_FAILED, "Voice connection was lost", { cause });
    this.#context.deleteQueue(voice.guildId, "voice-loss", error);
    this.#end(voice, "platform", error).catch((failure: unknown) => this.#report("voice.disconnect", failure));
  }

  #end(voice: DisTubeVoice<Target>, reason: VoiceDisconnectReason, error?: DisTubeError): Promise<void> {
    const { guildId, channelId } = voice;
    if (this.#voices.get(guildId) !== voice) return closeVoice(voice, error);
    this.#voices.delete(guildId);
    const ending = closeVoice(voice, error).finally(() => {
      if (this.#leaving.get(guildId) === ending) this.#leaving.delete(guildId);
      this.#context.events.emit("voice.disconnected", {
        guildId,
        voice,
        channelId,
        reason,
        timestamp: Date.now(),
        ...(error ? { error } : {}),
      });
    });
    this.#leaving.set(guildId, ending);
    return ending;
  }

  async #closeAll(): Promise<readonly unknown[]> {
    this.#disposed = true;
    const joins = [...this.#joins.values()].map(join => join.voice.catch(() => undefined));
    this.#joins.clear();
    const results = await Promise.allSettled([...this.#voices.values()].map(voice => this.#end(voice, "shutdown")));
    await Promise.all(joins);
    return results.flatMap(result => (result.status === "rejected" ? [result.reason] : []));
  }

  #report(stage: string, error: unknown): void {
    this.#context.events.report({ severity: "error", stage, message: `VoiceManager: ${stage}`, error });
  }

  #assertLive(): void {
    if (this.#disposed) throw new DisTubeError(ErrorCode.INVALID_STATE, "DisTube is disposed");
  }
}

function raceSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  const aborted = Promise.withResolvers<never>();
  const abort = (): void => aborted.reject(abortError(signal));
  signal.addEventListener("abort", abort, { once: true });
  return Promise.race([promise, aborted.promise]).finally(() => signal.removeEventListener("abort", abort));
}
