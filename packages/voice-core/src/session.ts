import type {
  DiscordGatewayAdapterCreator,
  DiscordGatewayAdapterLibraryMethods,
  VoiceConnection,
} from "@discordjs/voice";
import { entersState, joinVoiceChannel, VoiceConnectionStatus } from "@discordjs/voice";
import type {
  JoinOptions,
  VoiceGatewayData,
  VoiceSession,
  VoiceSessionEvent,
  VoiceSessionOptions,
  VoiceTarget,
} from "distube/integrations";

export interface DiscordVoiceSessionOptions extends VoiceTarget, VoiceSessionOptions {
  readonly clientUserId: string;
  readonly adapterCreator: DiscordGatewayAdapterCreator;
  /** The platform channel's bitrate in bits per second, read whenever the session needs it. */
  readonly channelBitrate: (channelId: string) => number;
}

/** Gateway membership stays alive independently of the selected audio transport. */
export class DiscordVoiceSession implements VoiceSession {
  readonly guildId: string;
  readonly clientUserId: string;
  readonly #options: DiscordVoiceSessionOptions;
  readonly #gatewayAdapter: ReturnType<DiscordGatewayAdapterCreator>;
  readonly #listeners = new Set<(event: VoiceSessionEvent) => void>();
  readonly #waiters = new Set<() => void>();
  #transport?: DiscordGatewayAdapterLibraryMethods;
  #connection?: VoiceConnection;
  #state?: Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceStateUpdate"]>[0];
  #server?: Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceServerUpdate"]>[0];
  #channelId: string;
  #gateway?: VoiceGatewayData;
  #selfDeaf: boolean;
  #selfMute: boolean;
  #released = false;
  #releasePromise?: Promise<void>;

  static async connect(options: DiscordVoiceSessionOptions): Promise<DiscordVoiceSession> {
    const session = new DiscordVoiceSession(options);
    try {
      await session.join(options.channelId, options);
    } catch (error) {
      await session.release().catch(() => undefined);
      throw error;
    }
    return session;
  }

  /** Private bridge used only by this package's local engine. */
  static async connectionOf(session: VoiceSession): Promise<VoiceConnection | undefined> {
    if (!(session instanceof DiscordVoiceSession) || session.#released) return undefined;
    if (session.#connection) throw new Error("Discord audio transport is already attached");
    const connection = joinVoiceChannel({
      guildId: session.guildId,
      channelId: session.channelId,
      selfDeaf: session.selfDeaf,
      selfMute: session.selfMute,
      adapterCreator: transport => {
        session.#transport = transport;
        // Native construction must finish before replay can establish its socket.
        queueMicrotask(() => {
          if (session.#transport !== transport || session.#released) return;
          if (session.#state) transport.onVoiceStateUpdate(session.#state);
          if (session.#server) transport.onVoiceServerUpdate(session.#server);
        });
        return {
          sendPayload: () => !session.#released,
          destroy: () => {
            if (session.#transport === transport) session.#transport = undefined;
          },
        };
      },
    });
    session.#connection = connection;
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, session.#options.timeoutMs);
      if (session.#released || session.#connection !== connection) throw new Error("Voice session was released");
    } catch (error) {
      DiscordVoiceSession.detachConnection(session, connection);
      throw error;
    }
    return connection;
  }

  /** The local Player retires its socket without changing gateway membership. */
  static detachConnection(session: VoiceSession, connection: VoiceConnection): void {
    if (!(session instanceof DiscordVoiceSession) || session.#connection !== connection) return;
    session.#connection = undefined;
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
  }

  constructor(options: DiscordVoiceSessionOptions) {
    this.#options = options;
    this.guildId = options.guildId;
    this.clientUserId = options.clientUserId;
    this.#channelId = options.channelId;
    this.#selfDeaf = options.selfDeaf;
    this.#selfMute = options.selfMute;
    this.#gatewayAdapter = options.adapterCreator({
      onVoiceStateUpdate: state => {
        if (this.#released || state.user_id !== this.clientUserId || state.guild_id !== this.guildId) return;
        if (state.channel_id === null) {
          this.#terminate(new Error("Discord removed the bot from voice"));
          return;
        }
        if (
          this.#state &&
          (this.#state.channel_id !== state.channel_id || this.#state.session_id !== state.session_id)
        ) {
          this.#gateway = undefined;
          this.#server = undefined;
        }
        this.#state = { ...state };
        this.#selfDeaf = state.self_deaf;
        this.#selfMute = state.self_mute;
        this.#settle();
      },
      onVoiceServerUpdate: server => {
        if (this.#released || server.guild_id !== this.guildId) return;
        this.#server = { ...server };
        if (!server.endpoint) this.#gateway = undefined;
        this.#settle();
      },
      destroy: () => this.#terminate(new Error("Discord gateway adapter was destroyed")),
    });
  }

  get channelId(): string {
    return this.#channelId;
  }
  get bitrate(): number {
    return this.#options.channelBitrate(this.#channelId);
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
    }, this.#options.timeoutMs);
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
      if (
        !this.#gatewayAdapter.sendPayload({
          op: 4,
          d: { guild_id: this.guildId, channel_id: channelId, self_deaf: selfDeaf, self_mute: selfMute },
        })
      )
        throw new Error("Discord gateway is unavailable");
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
          if (this.#connection) DiscordVoiceSession.detachConnection(this, this.#connection);
        },
        () =>
          this.#gatewayAdapter.sendPayload({
            op: 4,
            d: { guild_id: this.guildId, channel_id: null, self_deaf: this.selfDeaf, self_mute: this.selfMute },
          }),
        () => this.#gatewayAdapter.destroy(),
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
    this.#transport?.onVoiceStateUpdate(state);
    this.#transport?.onVoiceServerUpdate(server);
    for (const check of this.#waiters) check();
    if (
      previous &&
      Object.keys(gateway).every(
        key => previous[key as keyof VoiceGatewayData] === gateway[key as keyof VoiceGatewayData],
      )
    )
      return;
    for (const listener of this.#listeners) {
      try {
        listener({ type: "connected", channelId: this.channelId, gateway });
      } catch {}
    }
  }
}
