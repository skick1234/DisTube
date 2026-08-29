import type {
  ConnectionOptions,
  DiscordGatewayAdapterCreator,
  JoinConfig,
  VoiceConnection,
  VoiceConnectionDisconnectedState,
  VoiceConnectionState,
} from "@discordjs/voice";
import {
  entersState,
  joinVoiceChannel,
  VoiceConnectionDisconnectReason,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type { VoiceGatewayData, VoiceSession, VoiceSessionEvent } from "distube";
import { cleanupAll } from "./cleanup";

/** Discord severs the voice socket with this close code when it moves or removes the bot. */
const MOVED_OR_REMOVED = 4014;

/** How long a 4014 close counts as an in-progress move before it reads as a removal. */
const MOVE_GRACE_MS = 5_000;

/** Rejoin attempts a dropped connection gets before the session reports a terminal disconnect. */
const RECONNECT_ATTEMPTS = 3;

export interface DiscordVoiceSessionOptions {
  readonly guildId: string;
  readonly channelId: string;
  readonly clientUserId: string;
  readonly adapterCreator: DiscordGatewayAdapterCreator;
  readonly selfDeaf: boolean;
  readonly selfMute: boolean;
  readonly connectionTimeoutMs: number;
}

/**
 * One guild's voice presence over `@discordjs/voice`.
 *
 * The session outlives the tracks and queues that play through it: recoverable drops are rejoined
 * here, and core learns of the connection only when it ends for good.
 */
export class DiscordVoiceSession implements VoiceSession {
  readonly guildId: string;
  readonly clientUserId: string;
  readonly #connection: VoiceConnection;
  readonly #selfDeaf: boolean;
  readonly #selfMute: boolean;
  readonly #timeout: number;
  readonly #listeners = new Set<(event: VoiceSessionEvent) => void>();
  #channelId: string;
  #gateway?: VoiceGatewayData;
  #attempts = 0;
  #released = false;
  #releasePromise?: Promise<void>;

  /** Joins `options.channelId` and resolves once the connection can carry audio. */
  static async connect(options: DiscordVoiceSessionOptions): Promise<DiscordVoiceSession> {
    const session = new DiscordVoiceSession(options);
    try {
      await entersState(session.#connection, VoiceConnectionStatus.Ready, options.connectionTimeoutMs);
    } catch (error: unknown) {
      await session.release().catch(() => undefined);
      throw error;
    }
    session.#settle();
    return session;
  }

  /** @internal The native connection, reachable only from this package's default engine. */
  static connectionOf(session: VoiceSession): VoiceConnection | undefined {
    return session instanceof DiscordVoiceSession ? session.#connection : undefined;
  }

  constructor(options: DiscordVoiceSessionOptions) {
    this.guildId = options.guildId;
    this.clientUserId = options.clientUserId;
    this.#channelId = options.channelId;
    this.#selfDeaf = options.selfDeaf;
    this.#selfMute = options.selfMute;
    this.#timeout = options.connectionTimeoutMs;
    this.#connection = joinVoiceChannel({
      guildId: options.guildId,
      channelId: options.channelId,
      adapterCreator: options.adapterCreator,
      selfDeaf: options.selfDeaf,
      selfMute: options.selfMute,
    });
    this.#connection.on("stateChange", this.#onStateChange);
  }

  /** The last channel that reached Ready and became the session's committed presence. */
  get channelId(): string {
    return this.#channelId;
  }

  get gateway(): VoiceGatewayData | undefined {
    return this.#gateway;
  }

  async join(channelId: string): Promise<void> {
    if (this.#released) throw new Error(`Discord voice session for guild ${this.guildId} was released`);
    if (channelId === this.#channelId) return;
    const previousConfig = { ...this.#connection.joinConfig };
    const previousChannelId = this.#channelId;
    const move = { channelId, selfDeaf: this.#selfDeaf, selfMute: this.#selfMute };
    let accepted: boolean;
    try {
      accepted = this.#connection.rejoin(move);
    } catch (error: unknown) {
      this.#restoreOrTerminalize(previousConfig, previousChannelId, error);
    }
    if (!accepted) {
      this.#restoreOrTerminalize(
        previousConfig,
        previousChannelId,
        new Error(`Discord gateway is unavailable for guild ${this.guildId}`),
      );
    }
    try {
      await entersState(this.#connection, VoiceConnectionStatus.Ready, this.#timeout);
      this.#settle();
    } catch (error: unknown) {
      this.#restoreOrTerminalize(previousConfig, previousChannelId, error);
    }
  }

  release(): Promise<void> {
    this.#releasePromise ??= this.#performRelease();
    return this.#releasePromise;
  }

  subscribe(listener: (event: VoiceSessionEvent) => void): () => void {
    if (this.#released) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #performRelease(): Promise<void> {
    this.#terminalize();
    await cleanupAll([
      () => this.#connection.off("stateChange", this.#onStateChange),
      () => {
        if (this.#connection.state.status !== VoiceConnectionStatus.Destroyed) this.#connection.destroy();
      },
    ]);
  }

  /** Ends the session's authority synchronously, before any native teardown runs. */
  #terminalize(): void {
    this.#released = true;
    this.#gateway = undefined;
    this.#listeners.clear();
  }

  /** Reports the guild's presence as over, exactly once, and tears the connection down. */
  #terminate(error: Error): void {
    if (this.#released) return;
    const listeners = [...this.#listeners];
    void this.release().catch(() => undefined);
    for (const listener of listeners) this.#deliver(listener, { type: "disconnected", error });
  }

  readonly #onStateChange = (_previous: VoiceConnectionState, next: VoiceConnectionState): void => {
    if (this.#released) return;
    switch (next.status) {
      case VoiceConnectionStatus.Ready:
        this.#attempts = 0;
        this.#settle();
        return;
      case VoiceConnectionStatus.Disconnected:
        this.#onDisconnected(next);
        return;
      case VoiceConnectionStatus.Destroyed:
        this.#terminate(new Error(`Discord voice connection for guild ${this.guildId} was destroyed`));
        return;
      default:
        return;
    }
  };

  /** Sorts a dropped connection into a recoverable rejoin, a pending move, or the end of the guild's presence. */
  #onDisconnected(state: VoiceConnectionDisconnectedState): void {
    if (state.reason === VoiceConnectionDisconnectReason.WebSocketClose && state.closeCode === MOVED_OR_REMOVED) {
      void this.#awaitMove();
      return;
    }
    if (state.reason === VoiceConnectionDisconnectReason.Manual) {
      this.#terminate(new Error(`Discord voice connection for guild ${this.guildId} was disconnected`));
      return;
    }
    if (state.reason === VoiceConnectionDisconnectReason.AdapterUnavailable) {
      this.#terminate(new Error(`Discord gateway is unavailable for guild ${this.guildId}`));
      return;
    }
    this.#recover();
  }

  /** A 4014 close is either the gateway moving us, which re-signals, or removing us, which is terminal. */
  async #awaitMove(): Promise<void> {
    const moved = await Promise.race([
      entersState(this.#connection, VoiceConnectionStatus.Signalling, MOVE_GRACE_MS).then(
        () => true,
        () => false,
      ),
      entersState(this.#connection, VoiceConnectionStatus.Connecting, MOVE_GRACE_MS).then(
        () => true,
        () => false,
      ),
    ]);
    if (!moved) this.#terminate(new Error(`Discord removed guild ${this.guildId} from its voice channel`));
  }

  /** Rejoins the current channel while attempts remain; exhausting them ends the session. */
  #recover(): void {
    if (this.#released) return;
    if (this.#attempts >= RECONNECT_ATTEMPTS) {
      this.#terminate(new Error(`Discord voice connection for guild ${this.guildId} could not be recovered`));
      return;
    }
    this.#attempts++;
    const rejoined = this.#connection.rejoin({
      channelId: this.channelId,
      selfDeaf: this.#selfDeaf,
      selfMute: this.#selfMute,
    });
    if (!rejoined) this.#terminate(new Error(`Discord gateway is unavailable for guild ${this.guildId}`));
  }

  /** Restores the last committed native join state before reporting a failed move. */
  #restoreOrTerminalize(previousConfig: JoinConfig, previousChannelId: string, error: unknown): never {
    try {
      Object.assign(this.#connection.joinConfig, previousConfig);
      this.#channelId = previousChannelId;
    } catch (restoreError: unknown) {
      const original = error instanceof Error ? error : new Error(String(error));
      const restoration = restoreError instanceof Error ? restoreError : new Error(String(restoreError));
      const failure = new AggregateError(
        [original, restoration],
        `Discord voice session for guild ${this.guildId} could not restore its committed channel`,
      );
      this.#terminate(failure);
      throw failure;
    }
    throw error;
  }

  /** Records the settled channel and credentials, publishing whenever either changed. */
  #settle(): void {
    const options = this.#connectionOptions();
    if (!options) return;
    const channelId = this.#connection.joinConfig.channelId ?? options.channelId;
    const gateway: VoiceGatewayData = {
      sessionId: options.sessionId,
      token: options.token,
      endpoint: options.endpoint,
    };
    if (channelId === this.#channelId && this.#gateway && sameGateway(this.#gateway, gateway)) return;
    this.#channelId = channelId;
    this.#gateway = gateway;
    for (const listener of this.#listeners) this.#deliver(listener, { type: "connected", channelId, gateway });
  }

  #connectionOptions(): ConnectionOptions | undefined {
    const state = this.#connection.state;
    if (state.status !== VoiceConnectionStatus.Ready) return undefined;
    const networking = state.networking.state;
    return "connectionOptions" in networking ? networking.connectionOptions : undefined;
  }

  #deliver(listener: (event: VoiceSessionEvent) => void, event: VoiceSessionEvent): void {
    try {
      listener(event);
    } catch {
      // Subscriber failures are isolated; the session stays the connection authority.
    }
  }
}

function sameGateway(left: VoiceGatewayData, right: VoiceGatewayData): boolean {
  return left.sessionId === right.sessionId && left.token === right.token && left.endpoint === right.endpoint;
}
