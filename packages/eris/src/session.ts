import type { VoiceGatewayData, VoiceSession, VoiceSessionEvent } from "distube";
import type { Client, RawPacket, VoiceConnection } from "eris";
import { collectCleanupFailures, throwCleanupFailures } from "./cleanup";
import { ensureErisErrorSink } from "./native-playback";
import { assertGuildVoiceChannel, objectRecord } from "./validation";

export interface ErisVoiceSessionOptions {
  readonly client: Client;
  readonly guildId: string;
  readonly channelId: string;
  readonly selfDeaf: boolean;
  readonly selfMute: boolean;
  readonly connectionTimeoutMs: number;
}

/**
 * One guild's voice presence over Eris.
 *
 * Eris recovers dropped sockets on its own and emits `disconnect` only once a connection is gone
 * for good, so that event is exactly the terminal outcome core is owed.
 */
export class ErisVoiceSession implements VoiceSession {
  readonly guildId: string;
  readonly #client: Client;
  readonly #selfDeaf: boolean;
  readonly #selfMute: boolean;
  readonly #timeout: number;
  readonly #listeners = new Set<(event: VoiceSessionEvent) => void>();
  #connection?: VoiceConnection;
  #channelId: string;
  #sessionId?: string;
  #token?: string;
  #endpoint?: string;
  #gateway?: VoiceGatewayData;
  #released = false;
  #joining?: string;
  #releasePromise?: Promise<void>;

  /** Joins `options.channelId` and resolves once the connection can carry audio. */
  static async connect(options: ErisVoiceSessionOptions): Promise<ErisVoiceSession> {
    const session = new ErisVoiceSession(options);
    try {
      await session.join(options.channelId);
    } catch (error: unknown) {
      await session.release().catch(() => undefined);
      throw error;
    }
    return session;
  }

  /** @internal The native connection, reachable only from this package's default engine. */
  static connectionOf(session: VoiceSession): VoiceConnection | undefined {
    return session instanceof ErisVoiceSession ? session.#connection : undefined;
  }

  constructor(options: ErisVoiceSessionOptions) {
    this.guildId = options.guildId;
    this.#client = options.client;
    this.#channelId = options.channelId;
    this.#selfDeaf = options.selfDeaf;
    this.#selfMute = options.selfMute;
    this.#timeout = options.connectionTimeoutMs;
    // Credentials are only ever on the wire, so the gateway is watched from before the first join.
    this.#client.on("rawWS", this.#onRawWS);
  }

  /** The last channel this session has positively confirmed as connected. */
  get channelId(): string {
    return this.#channelId;
  }

  get gateway(): VoiceGatewayData | undefined {
    return this.#gateway;
  }

  async join(channelId: string): Promise<void> {
    if (this.#released) throw new Error(`Eris voice session for guild ${this.guildId} was released`);
    // A move is validated like the first join: Eris would otherwise follow the channel into its own guild.
    assertGuildVoiceChannel(this.#client, this.guildId, channelId);
    const previousChannelId = this.#connection ? this.#channelId : undefined;
    this.#joining = channelId;
    try {
      const connection = await this.#connect(channelId);
      if (this.#released) throw new Error(`Eris voice session for guild ${this.guildId} was released`);
      this.#assertConnectedChannel(connection, channelId);
      this.#adopt(connection);
      this.#channelId = channelId;
      this.#joining = undefined;
      this.#settle();
    } catch (error: unknown) {
      this.#joining = undefined;
      if (this.#released || !previousChannelId || this.#connection?.channelID === previousChannelId) throw error;
      await this.#restore(previousChannelId, error);
      throw error;
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

  /** Joins or moves, failing the request rather than waiting forever on an unanswered gateway. */
  async #connect(channelId: string): Promise<VoiceConnection> {
    const join = this.#client.joinVoiceChannel(channelId, { selfDeaf: this.#selfDeaf, selfMute: this.#selfMute });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        join,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Eris voice connection timed out")), this.#timeout);
        }),
      ]);
    } catch (error: unknown) {
      // A first join that never settled must not leave a connection behind; a move keeps the old one.
      if (!this.#connection) {
        this.#client.leaveVoiceChannel(channelId);
        void join.then(
          () => this.#client.leaveVoiceChannel(channelId),
          () => undefined,
        );
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Reverses a native channel mutation that Eris made before rejecting or timing out a move. */
  async #restore(channelId: string, moveError: unknown): Promise<void> {
    this.#joining = channelId;
    try {
      const connection = await this.#connect(channelId);
      if (this.#released) throw new Error(`Eris voice session for guild ${this.guildId} was released`);
      this.#assertConnectedChannel(connection, channelId);
      this.#adopt(connection);
      this.#channelId = channelId;
      this.#joining = undefined;
      this.#settle();
    } catch (restoreError: unknown) {
      this.#joining = undefined;
      const error = new AggregateError(
        [asError(moveError), asError(restoreError)],
        "Eris voice move restoration failed",
      );
      this.#terminate(error);
      throw error;
    }
  }

  /** `joinVoiceChannel` resolves only after Eris signals readiness; prove it still points at the requested channel. */
  #assertConnectedChannel(connection: VoiceConnection, channelId: string): void {
    if (connection.channelID !== channelId) {
      throw new Error(`Eris voice connection did not enter channel ${channelId}`);
    }
  }

  /** Takes ownership of the guild's connection, moving native listeners off any previous one. */
  #adopt(connection: VoiceConnection): void {
    if (this.#connection === connection) return;
    this.#detach();
    this.#connection = connection;
    ensureErisErrorSink(connection);
    connection.on("disconnect", this.#onDisconnect);
  }

  #detach(): void {
    this.#connection?.off("disconnect", this.#onDisconnect);
  }

  async #performRelease(): Promise<void> {
    const channelId = this.channelId;
    this.#terminalize();
    throwCleanupFailures(
      collectCleanupFailures([
        () => this.#client.off("rawWS", this.#onRawWS),
        () => this.#detach(),
        () => this.#client.leaveVoiceChannel(channelId),
      ]),
    );
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

  readonly #onDisconnect = (error?: Error): void => {
    this.#terminate(error ?? new Error(`Eris voice connection for guild ${this.guildId} was disconnected`));
  };

  /** Collects the voice-server and voice-state data an engine needs, straight off the gateway. */
  readonly #onRawWS = (packet: RawPacket): void => {
    if (this.#released) return;
    const data = objectRecord(packet.d);
    if (!data || data.guild_id !== this.guildId) return;
    if (packet.t === "VOICE_SERVER_UPDATE") {
      if (typeof data.token !== "string" || typeof data.endpoint !== "string") return;
      this.#token = data.token;
      this.#endpoint = data.endpoint;
    } else if (packet.t === "VOICE_STATE_UPDATE") {
      if (data.user_id !== this.#client.user?.id || typeof data.session_id !== "string") return;
      this.#sessionId = data.session_id;
    } else {
      return;
    }
    this.#settle();
  };

  /** Records the settled channel and credentials, publishing whenever either changed. */
  #settle(): void {
    if (this.#released || this.#joining || !this.#sessionId || !this.#token || !this.#endpoint) return;
    const channelId = this.channelId;
    const gateway: VoiceGatewayData = { sessionId: this.#sessionId, token: this.#token, endpoint: this.#endpoint };
    if (channelId === this.#channelId && this.#gateway && sameGateway(this.#gateway, gateway)) return;
    this.#channelId = channelId;
    this.#gateway = gateway;
    for (const listener of this.#listeners) this.#deliver(listener, { type: "connected", channelId, gateway });
  }

  #deliver(listener: (event: VoiceSessionEvent) => void, event: VoiceSessionEvent): void {
    try {
      listener(event);
    } catch {
      // Subscriber failures are isolated; the session stays the connection authority.
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function sameGateway(left: VoiceGatewayData, right: VoiceGatewayData): boolean {
  return left.sessionId === right.sessionId && left.token === right.token && left.endpoint === right.endpoint;
}
