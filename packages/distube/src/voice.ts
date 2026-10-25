import type { Adapter, VoiceChannelTarget, VoiceTarget } from "./contracts";
import { DisTubeError, ErrorCode, requireBoolean, throwIfAborted } from "./errors";
import { FilterManager } from "./filters";
import type { Connection, Guild, Guilds } from "./guild";

/** Options for `distube.voices.join`; an omitted flag keeps the voice's current one. */
export interface VoiceJoinOptions {
  /** Default `true`. */
  readonly selfDeaf?: boolean;
  /** Default `false`. */
  readonly selfMute?: boolean;
  readonly signal?: AbortSignal;
}

export function normalizeTarget<Target>(adapter: Adapter<Target>, target: Target): VoiceTarget {
  let normalized: VoiceTarget;
  try {
    normalized = adapter.normalizeTarget(target);
  } catch (error: unknown) {
    if (DisTubeError.is(error, ErrorCode.INVALID_ARGUMENT)) throw error;
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Voice target could not be normalized", { cause: error });
  }
  const { guildId, channelId } = normalized;
  return Object.freeze({ guildId: requireId(guildId, "guildId"), channelId: requireId(channelId, "channelId") });
}

function requireId(id: unknown, name: string): string {
  if (typeof id !== "string" || id.length === 0)
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${name} must be a non-empty string`);
  return id;
}

/**
 * One guild's voice connection and the settings that outlive its queues: volume, filters, self-deaf and self-mute.
 * Playback controls live on `DisTubeQueue`. With no queue the voice leaves after `DisTubeOptions.idleTimeoutMs`.
 */
export class DisTubeVoice<Target = VoiceChannelTarget> {
  readonly filters: FilterManager;
  readonly #guild: Guild<Target>;
  readonly #connection: Connection;

  /** @internal */
  constructor(guild: Guild<Target>, connection: Connection) {
    this.#guild = guild;
    this.#connection = connection;
    this.filters = new FilterManager(guild.config.engine, guild, connection);
  }

  get guildId(): string {
    return this.#guild.id;
  }

  /** The last channel the platform acknowledged. */
  get channelId(): string {
    return this.#connection.channelId;
  }

  get volume(): number {
    return this.#connection.volume;
  }

  get selfDeaf(): boolean {
    return this.#connection.session.selfDeaf;
  }

  get selfMute(): boolean {
    return this.#connection.session.selfMute;
  }

  /** Percentage from 0 to 100; committed once the Player applies it. */
  async setVolume(percent: number): Promise<void> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Volume must be between 0 and 100");
    await this.#guild.setVolume(this.#connection, percent);
  }

  /** Runs after any pending move and writes to the channel acknowledged by then. */
  async setSelfDeaf(enabled: boolean): Promise<void> {
    requireBoolean(enabled, "selfDeaf");
    await this.#guild.setSelfState(this.#connection, { selfDeaf: enabled });
  }

  /** Runs after any pending move and writes to the channel acknowledged by then. */
  async setSelfMute(enabled: boolean): Promise<void> {
    requireBoolean(enabled, "selfMute");
    await this.#guild.setSelfState(this.#connection, { selfMute: enabled });
  }

  /** Moves in call order; each move compares its target with the channel acknowledged when it runs. */
  async move(channel: Target): Promise<void> {
    const target = normalizeTarget(this.#guild.config.adapter, channel);
    if (target.guildId !== this.guildId)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Cannot move voice to another guild");
    await this.#guild.move(this.#connection, target.channelId);
  }

  /** Deletes the guild queue, then releases the Player and the session. */
  leave(): Promise<void> {
    return this.#guild.leaveFrom(this.#connection);
  }
}

/** The connected guild voices, usable with or without a queue. */
export class VoiceManager<Target = VoiceChannelTarget> {
  readonly #guilds: Guilds<Target>;

  /** @internal */
  constructor(guilds: Guilds<Target>) {
    this.#guilds = guilds;
  }

  get size(): number {
    return this.#guilds.voices.size;
  }

  [Symbol.iterator](): IterableIterator<DisTubeVoice<Target>> {
    return this.#guilds.voices.values();
  }

  get(guildId: string): DisTubeVoice<Target> | undefined {
    return this.#guilds.voices.get(guildId);
  }

  has(guildId: string): boolean {
    return this.#guilds.voices.has(guildId);
  }

  /** Connects to `channel`, or moves the guild's existing voice there. */
  async join(channel: Target, options: VoiceJoinOptions = {}): Promise<DisTubeVoice<Target>> {
    const { adapter, lifetime } = this.#guilds.config;
    const target = normalizeTarget(adapter, channel);
    if (options.selfDeaf !== undefined) requireBoolean(options.selfDeaf, "selfDeaf");
    if (options.selfMute !== undefined) requireBoolean(options.selfMute, "selfMute");
    throwIfAborted(options.signal);
    if (lifetime.aborted) throw new DisTubeError(ErrorCode.INVALID_STATE, "DisTube is disposed");
    const voice = await this.#guilds.ensure(target.guildId).connect(target.channelId, options);
    await voice.move(channel);
    if (options.selfDeaf !== undefined && voice.selfDeaf !== options.selfDeaf)
      await voice.setSelfDeaf(options.selfDeaf);
    if (options.selfMute !== undefined && voice.selfMute !== options.selfMute)
      await voice.setSelfMute(options.selfMute);
    throwIfAborted(options.signal);
    return voice;
  }

  /** Deletes the guild queue, then releases its voice or waits out a pending join. Concurrent calls share one cleanup. */
  leave(guildId: string): Promise<void> {
    return this.#guilds.get(guildId)?.leave() ?? Promise.resolve();
  }
}
