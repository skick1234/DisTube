import type {
  DiscordGatewayAdapterCreator,
  DiscordGatewayAdapterLibraryMethods,
  VoiceConnection,
  VoiceConnectionState,
} from "@discordjs/voice";
import { entersState, joinVoiceChannel, VoiceConnectionStatus } from "@discordjs/voice";
import { DisTubeError } from "distube";
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
  /** Throws when the platform would refuse a join to `channelId`; runs before connecting and before each move. */
  readonly preflight: (channelId: string) => void;
}

/** https://docs.discord.com/developers/topics/opcodes-and-status-codes#voice-voice-close-event-codes */
const REJOIN_CLOSE_CODES: ReadonlySet<number> = new Set([4006, 4009]);
const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([4004, 4011, 4016, 4017, 4021, 4022]);
const DISCONNECTED_CLOSE_CODE = 4014;
const REJOIN_LIMIT = 3;
const REJOIN_WINDOW_MS = 60_000;

interface VoiceStateUpdate {
  readonly channel_id: string | null;
  readonly self_deaf: boolean;
  readonly self_mute: boolean;
}

interface VoiceStatePayload {
  readonly op: 4;
  readonly d: VoiceStateUpdate & { readonly guild_id: string };
}

/** Gateway membership stays alive independently of the selected audio transport. */
export class DiscordVoiceSession implements VoiceSession {
  readonly guildId: string;
  readonly clientUserId: string;
  readonly #options: DiscordVoiceSessionOptions;
  readonly #gatewayAdapter: ReturnType<DiscordGatewayAdapterCreator>;
  readonly #listeners = new Set<(event: VoiceSessionEvent) => void>();
  readonly #waiters = new Set<() => void>();
  #writes: Promise<void> = Promise.resolve();
  #transport?: DiscordGatewayAdapterLibraryMethods;
  #connection?: VoiceConnection;
  #state?: Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceStateUpdate"]>[0];
  #server?: Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceServerUpdate"]>[0];
  #channelId: string;
  #gateway?: VoiceGatewayData;
  #selfDeaf: boolean;
  #selfMute: boolean;
  #leaving = false;
  #rejoins: number[] = [];
  #recovery?: ReturnType<typeof setTimeout>;
  #released = false;
  #releasePromise?: Promise<void>;

  static async connect(options: DiscordVoiceSessionOptions): Promise<DiscordVoiceSession> {
    const { signal } = options;
    if (signal?.aborted) throw joinAborted(signal);
    options.preflight(options.channelId);
    const session = new DiscordVoiceSession(options);
    const release = (): void => void session.release().catch(() => undefined);
    signal?.addEventListener("abort", release, { once: true });
    try {
      await session.join(options.channelId, options);
      if (signal?.aborted) throw joinAborted(signal);
    } catch (error) {
      await session.release().catch(() => undefined);
      throw signal?.aborted ? joinAborted(signal) : error;
    } finally {
      signal?.removeEventListener("abort", release);
    }
    return session;
  }

  /** Private bridge used only by this package's local engine. */
  static async connectionOf(session: VoiceSession): Promise<VoiceConnection | undefined> {
    if (!(session instanceof DiscordVoiceSession) || session.#released) return undefined;
    if (session.#connection) throw new Error("Discord audio transport is already attached");
    const connection = joinVoiceChannel({
      guildId: session.guildId,
      group: session.clientUserId,
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
          sendPayload: (payload: VoiceStatePayload) =>
            session.#transport === transport && session.#connection !== undefined && session.#forward(payload),
          destroy: () => {
            if (session.#transport === transport) session.#transport = undefined;
          },
        };
      },
    });
    connection.on("error", () => undefined);
    connection.on("stateChange", (previous: VoiceConnectionState, next: VoiceConnectionState) =>
      session.#watch(connection, previous, next),
    );
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
    session.#recovered();
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
          if (this.#leaving) this.#state = undefined;
          else this.#terminate(new Error("Discord removed the bot from voice"));
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
        this.#transport?.onVoiceStateUpdate(this.#state);
        this.#settle();
      },
      onVoiceServerUpdate: server => {
        if (this.#released || server.guild_id !== this.guildId) return;
        this.#server = { ...server };
        if (!server.endpoint) this.#gateway = undefined;
        this.#transport?.onVoiceServerUpdate(this.#server);
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

  join(channelId: string, options: JoinOptions = {}): Promise<void> {
    return this.#enqueue(() => this.#join(channelId, options));
  }
  setSelfState(state: JoinOptions): Promise<void> {
    return this.#enqueue(() => this.#join(this.#channelId, state));
  }
  voiceClosed(code: number): void {
    if (this.#released || this.#endedBy(code) || !REJOIN_CLOSE_CODES.has(code) || !this.#spendRejoin(code)) return;
    this.#enqueue(() => this.#rejoin(false)).catch((error: unknown) => this.#terminate(asError(error)));
  }
  rejoin(): Promise<void> {
    return this.#enqueue(() => this.#rejoin(true)).catch((error: unknown) => {
      this.#terminate(asError(error));
      throw error;
    });
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
    this.#recovered();
    for (const check of this.#waiters) check();
    this.#listeners.clear();
    this.#releasePromise = this.#enqueue(async () => {
      const failures: unknown[] = [];
      for (const action of [
        () => {
          if (this.#connection) DiscordVoiceSession.detachConnection(this, this.#connection);
        },
        () => this.#sendUpdate({ channel_id: null, self_deaf: this.selfDeaf, self_mute: this.selfMute }),
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

  #enqueue(write: () => Promise<void>): Promise<void> {
    const run = this.#writes.then(write);
    this.#writes = run.catch(() => undefined);
    return run;
  }

  async #join(channelId: string, { selfDeaf = this.#selfDeaf, selfMute = this.#selfMute }: JoinOptions): Promise<void> {
    if (this.#released) throw sessionReleased();
    if (this.#gateway?.channelId === channelId && selfDeaf === this.#selfDeaf && selfMute === this.#selfMute) return;
    await this.#request(
      { channel_id: channelId, self_deaf: selfDeaf, self_mute: selfMute },
      () => this.#gateway?.channelId === channelId && this.#selfDeaf === selfDeaf && this.#selfMute === selfMute,
    );
  }

  /** Rejoins the held channel and waits for the credentials the platform sends for it, so `connected` follows. */
  async #rejoin(leaveFirst: boolean): Promise<void> {
    if (this.#released) throw sessionReleased();
    const channelId = this.#channelId;
    const flags = { self_deaf: this.#selfDeaf, self_mute: this.#selfMute };
    this.#server = undefined;
    this.#gateway = undefined;
    this.#leaving = leaveFirst;
    try {
      if (leaveFirst && !this.#sendUpdate({ channel_id: null, ...flags })) throw gatewayUnavailable();
      await this.#request({ channel_id: channelId, ...flags }, () => this.#gateway?.channelId === channelId);
    } finally {
      this.#leaving = false;
    }
  }

  #request(update: VoiceStateUpdate, acknowledged: () => boolean): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const finish = (): void => {
      clearTimeout(timer);
      this.#waiters.delete(check);
    };
    const fail = (error: unknown): void => {
      finish();
      reject(error);
    };
    const check = (): void => {
      if (this.#released) fail(sessionReleased());
      else if (acknowledged()) {
        finish();
        resolve();
      }
    };
    const timer = setTimeout(() => fail(new Error("Discord gateway membership timed out")), this.#options.timeoutMs);
    this.#waiters.add(check);
    try {
      if (!this.#sendUpdate(update)) fail(gatewayUnavailable());
    } catch (error) {
      fail(error);
    }
    return promise;
  }

  #sendUpdate(update: VoiceStateUpdate): boolean {
    return this.#send({ op: 4, d: { guild_id: this.guildId, ...update } });
  }

  /** Discord never answers a join it refuses, so a refused target would otherwise wait out the join deadline. */
  #send(payload: VoiceStatePayload): boolean {
    const channelId = payload.d.channel_id;
    if (channelId !== null && channelId !== this.#channelId) this.#options.preflight(channelId);
    return this.#gatewayAdapter.sendPayload(payload);
  }

  /** The library's own join after a voice socket close; its leave stays suppressed because the session owns it. */
  #forward(payload: VoiceStatePayload): boolean {
    if (this.#released || payload.d.channel_id === null) return false;
    let sent = false;
    try {
      sent = this.#send(payload);
    } catch {}
    if (!sent) this.#terminate(new Error("Discord gateway could not send the voice rejoin"));
    return sent;
  }

  #watch(connection: VoiceConnection, previous: VoiceConnectionState, next: VoiceConnectionState): void {
    if (this.#connection !== connection) return;
    const networking = "networking" in next ? next.networking : undefined;
    // @discordjs/voice keeps close codes off the connection state, so read them before the library rejoins.
    if (networking && networking !== ("networking" in previous ? previous.networking : undefined))
      networking.prependOnceListener("close", (code: number) => this.#socketClosed(connection, code));
    if (next.status === VoiceConnectionStatus.Ready) this.#recovered();
  }

  /** Every other close makes the library send its own join, which counts against the budget until Ready. */
  #socketClosed(connection: VoiceConnection, code: number): void {
    if (this.#released || this.#connection !== connection || code === DISCONNECTED_CLOSE_CODE) return;
    if (this.#endedBy(code) || !this.#spendRejoin(code)) return;
    clearTimeout(this.#recovery);
    this.#recovery = setTimeout(
      () => this.#terminate(new Error(`Discord voice did not reconnect after close ${code} within the join timeout`)),
      this.#options.timeoutMs,
    );
  }

  #endedBy(code: number): boolean {
    if (!TERMINAL_CLOSE_CODES.has(code)) return false;
    this.#terminate(new Error(`Discord voice closed with code ${code}`));
    return true;
  }

  #spendRejoin(code: number): boolean {
    const now = Date.now();
    this.#rejoins = this.#rejoins.filter(at => now - at < REJOIN_WINDOW_MS);
    if (this.#rejoins.length >= REJOIN_LIMIT) {
      this.#terminate(new Error(`Discord voice closed with code ${code} after ${REJOIN_LIMIT} rejoins within 60 s`));
      return false;
    }
    this.#rejoins.push(now);
    return true;
  }

  #recovered(): void {
    clearTimeout(this.#recovery);
    this.#recovery = undefined;
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
    for (const listener of this.#listeners) {
      try {
        listener({ type: "connected", channelId: this.channelId, gateway });
      } catch {}
    }
  }
}

function joinAborted(signal: AbortSignal): DisTubeError {
  return new DisTubeError("ABORTED", "Voice join was aborted", { cause: signal.reason });
}

function sessionReleased(): Error {
  return new Error("Voice session was released");
}

function gatewayUnavailable(): Error {
  return new Error("Discord gateway is unavailable");
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
