import type { JoinOptions, VoiceGatewayData, VoiceSession, VoiceSessionEvent } from "distube/integrations";
import type { Client, RawPacket } from "eris";
import { VoiceConnection } from "eris";
import { ensureErisErrorSink } from "./native-playback";

export interface ErisVoiceSessionOptions {
  readonly guildId: string;
  readonly channelId: string;
  readonly clientUserId: string;
  readonly client: Client;
  readonly selfDeaf: boolean;
  readonly selfMute: boolean;
  readonly connectionTimeoutMs: number;
}

/** Gateway membership stays alive independently of the selected audio transport. */
export class ErisVoiceSession implements VoiceSession {
  readonly guildId: string;
  readonly clientUserId: string;
  readonly #options: ErisVoiceSessionOptions;

  readonly #listeners = new Set<(event: VoiceSessionEvent) => void>();
  readonly #waiters = new Set<() => void>();

  #connection?: VoiceConnection;
  #state?: GatewayState;
  #server?: GatewayServer;
  #channelId: string;
  #gateway?: VoiceGatewayData;
  #selfDeaf: boolean;
  #selfMute: boolean;
  #released = false;
  #releasePromise?: Promise<void>;

  static async connect(options: ErisVoiceSessionOptions): Promise<ErisVoiceSession> {
    const session = new ErisVoiceSession(options);
    try {
      await session.join(options.channelId, options);
    } catch (error) {
      await session.release().catch(() => undefined);
      throw error;
    }
    return session;
  }

  static assertTarget(client: Client, guildId: string, channelId: string): void {
    const channel = client.getChannel(channelId);
    if (!channel || (channel.type !== 2 && channel.type !== 13) || channel.guild.id !== guildId)
      throw new Error("Invalid Eris voice channel");
  }

  static async connectionOf(session: VoiceSession): Promise<VoiceConnection | undefined> {
    if (!(session instanceof ErisVoiceSession) || session.#released || !session.gateway) return undefined;
    if (session.#connection) throw new Error("Eris audio transport is already attached");
    const connection = new VoiceConnection(session.guildId);
    suppressTransportVoiceState(connection);
    ensureErisErrorSink(connection);
    session.#connection = connection;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timer = setTimeout(
      () => reject(new Error("Eris transport readiness timed out")),
      session.#options.connectionTimeoutMs,
    );
    const ready = (): void => resolve();
    const failed = (error: Error): void => reject(new Error(error.message));
    const disconnected = (): void => reject(new Error("Eris transport disconnected before it became ready"));
    connection.once("ready", ready).once("error", failed).once("disconnect", disconnected);
    try {
      session.#refreshTransport();
      await promise;
      if (session.#released || session.#connection !== connection) throw new Error("Voice session was released");
    } catch (error) {
      ErisVoiceSession.detachConnection(session, connection);
      throw error;
    } finally {
      clearTimeout(timer);
      connection.off("ready", ready).off("error", failed).off("disconnect", disconnected);
    }
    return connection;
  }

  /** The local Player retires its socket without changing gateway membership. */
  static detachConnection(session: VoiceSession, connection: VoiceConnection): void {
    if (!(session instanceof ErisVoiceSession) || session.#connection !== connection) return;
    session.#connection = undefined;
    if (connection.ready || connection.connecting || connection.channelID !== null) connection.disconnect();
  }

  constructor(options: ErisVoiceSessionOptions) {
    this.#options = options;
    this.guildId = options.guildId;
    this.clientUserId = options.clientUserId;
    this.#channelId = options.channelId;
    this.#selfDeaf = options.selfDeaf;
    this.#selfMute = options.selfMute;
    options.client.on("rawWS", this.#onRaw);
  }
  readonly #onRaw = (packet: RawPacket): void => {
    if (this.#released || typeof packet.d !== "object" || packet.d === null) return;
    const data = packet.d as Record<string, unknown>;
    if (data.guild_id !== this.guildId) return;
    if (packet.t === "VOICE_STATE_UPDATE") {
      if (data.user_id !== this.clientUserId) return;
      if (data.channel_id === null) {
        this.#terminate(new Error("Discord removed the bot from voice"));
        return;
      }
      if (typeof data.channel_id !== "string" || typeof data.session_id !== "string") return;
      if (this.#state && (this.#state.channel_id !== data.channel_id || this.#state.session_id !== data.session_id)) {
        this.#gateway = undefined;
        this.#server = undefined;
      }
      this.#state = { channel_id: data.channel_id, session_id: data.session_id };
      if (typeof data.self_deaf === "boolean") this.#selfDeaf = data.self_deaf;
      if (typeof data.self_mute === "boolean") this.#selfMute = data.self_mute;
    } else if (packet.t === "VOICE_SERVER_UPDATE") {
      if (typeof data.token !== "string") return;
      this.#server = { token: data.token, endpoint: typeof data.endpoint === "string" ? data.endpoint : null };
      if (!data.endpoint) this.#gateway = undefined;
    } else return;
    this.#settle();
  };
  #send(channelId: string | null, selfDeaf: boolean, selfMute: boolean): void {
    const guild = this.#options.client.guilds.get(this.guildId);
    if (!guild) throw new Error("Eris guild is unavailable");
    guild.shard.sendWS(4, { guild_id: this.guildId, channel_id: channelId, self_deaf: selfDeaf, self_mute: selfMute });
  }
  #refreshTransport(): void {
    const gateway = this.gateway;
    if (!gateway || !this.#connection) return;
    this.#connection.connect({
      channel_id: gateway.channelId,
      session_id: gateway.sessionId,
      endpoint: gateway.endpoint,
      token: gateway.token,
      user_id: this.clientUserId,
    });
  }

  get channelId(): string {
    return this.#channelId;
  }
  get gateway(): VoiceGatewayData | undefined {
    return this.#gateway;
  }
  get selfDeaf(): boolean {
    return this.#selfDeaf;
  }
  get selfMute(): boolean {
    return this.#selfMute;
  }

  async join(channelId: string, options: JoinOptions = {}): Promise<void> {
    if (this.#released) throw new Error("Voice session was released");
    ErisVoiceSession.assertTarget(this.#options.client, this.guildId, channelId);
    const selfDeaf = options.selfDeaf ?? this.#selfDeaf;
    const selfMute = options.selfMute ?? this.#selfMute;
    if (this.#gateway?.channelId === channelId && selfDeaf === this.selfDeaf && selfMute === this.selfMute) return;
    const previous = { state: this.#state, server: this.#server, gateway: this.#gateway };
    if (channelId !== this.channelId) {
      this.#state = undefined;
      this.#server = undefined;
      this.#gateway = undefined;
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timer = setTimeout(() => {
      this.#waiters.delete(check);
      reject(new Error("Discord gateway membership timed out"));
    }, this.#options.connectionTimeoutMs);
    const check = (): void => {
      if (
        !this.#released &&
        !(this.#gateway?.channelId === channelId && this.selfDeaf === selfDeaf && this.selfMute === selfMute)
      )
        return;
      clearTimeout(timer);
      this.#waiters.delete(check);
      if (this.#released) reject(new Error("Voice session was released"));
      else resolve();
    };
    this.#waiters.add(check);
    try {
      this.#send(channelId, selfDeaf, selfMute);
    } catch (error) {
      clearTimeout(timer);
      this.#waiters.delete(check);
      reject(error);
    }
    try {
      await promise;
    } catch (error) {
      if (!this.#released && this.#gateway?.channelId !== channelId) {
        this.#state = previous.state;
        this.#server = previous.server;
        this.#gateway = previous.gateway;
      }
      throw error;
    }
  }
  setSelfDeaf(value: boolean): Promise<void> {
    return this.join(this.channelId, { selfDeaf: value });
  }
  setSelfMute(value: boolean): Promise<void> {
    return this.join(this.channelId, { selfMute: value });
  }
  subscribe(listener: (event: VoiceSessionEvent) => void): () => void {
    if (this.#released) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  release(): Promise<void> {
    if (this.#releasePromise) return this.#releasePromise;
    this.#released = true;
    this.#gateway = undefined;
    for (const check of this.#waiters) check();
    this.#listeners.clear();
    this.#releasePromise = Promise.resolve().then(() => {
      const failures: unknown[] = [];
      for (const action of [
        () => {
          if (this.#connection) ErisVoiceSession.detachConnection(this, this.#connection);
        },
        () => this.#send(null, this.selfDeaf, this.selfMute),
        () => this.#options.client.off("rawWS", this.#onRaw),
      ]) {
        try {
          action();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, "Voice session cleanup failed");
    });
    return this.#releasePromise;
  }
  #terminate(error: Error): void {
    if (this.#released) return;
    const listeners = [...this.#listeners];
    void this.release().catch(() => undefined);
    for (const listener of listeners) {
      try {
        listener({ type: "disconnected", error });
      } catch {}
    }
  }
  #settle(): void {
    const state = this.#state;
    const server = this.#server;
    if (!state?.channel_id || !state.session_id || !server?.endpoint || !server.token) return;
    const gateway = Object.freeze({
      channelId: state.channel_id,
      sessionId: state.session_id,
      token: server.token,
      endpoint: server.endpoint,
    });
    const previous = this.#gateway;
    this.#gateway = gateway;
    this.#channelId = gateway.channelId;

    for (const check of this.#waiters) check();
    if (
      previous &&
      Object.keys(gateway).every(
        key => previous[key as keyof VoiceGatewayData] === gateway[key as keyof VoiceGatewayData],
      )
    )
      return;
    this.#refreshTransport();
    for (const listener of this.#listeners) {
      try {
        listener({ type: "connected", channelId: this.channelId, gateway });
      } catch {}
    }
  }
}

interface GatewayState {
  channel_id: string;
  session_id: string;
}
interface GatewayServer {
  token: string;
  endpoint: string | null;
}

/** Eris disconnect calls this method with a null channel; only the session may send membership. */
export function suppressTransportVoiceState(connection: VoiceConnection): void {
  connection.updateVoiceState = () => undefined;
}
