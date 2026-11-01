import type {
  DiscordGatewayAdapterCreator,
  DiscordGatewayAdapterLibraryMethods,
  VoiceConnection,
  VoiceConnectionState,
} from "@discordjs/voice";
import { joinVoiceChannel, VoiceConnectionDisconnectReason, VoiceConnectionStatus } from "@discordjs/voice";
import { DisTubeError } from "distube";
import type {
  JoinOptions,
  VoiceGatewayData,
  VoiceSession,
  VoiceSessionEvent,
  VoiceSessionOptions,
  VoiceTarget,
} from "distube/integrations";

export interface DiscordPlatform {
  readonly clientUserId: string;
  readonly adapterCreator: DiscordGatewayAdapterCreator;
  readonly channelBitrate: (channelId: string) => number;
  readonly preflight: (channelId: string) => void;
}

export interface DiscordVoiceSessionOptions extends VoiceTarget, VoiceSessionOptions, DiscordPlatform {}

/** https://docs.discord.com/developers/topics/opcodes-and-status-codes#voice-voice-close-event-codes */
const REJOIN_CLOSE_CODES: ReadonlySet<number> = new Set([4006, 4009]);
const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([4004, 4011, 4016, 4017, 4021]);
const PLATFORM_CLOSE_CODES: ReadonlySet<number> = new Set([4014, 4022]);
const DAVE_REQUIRED_CLOSE_CODE = 4017;
const REJOIN_LIMIT = 3;
const REJOIN_WINDOW_MS = 60_000;
/** The gateway adapter contract has no ready signal, so a refused payload is retried until it goes out. */
const RESEND_INTERVAL_MS = 1_000;

interface VoiceStateUpdate {
  readonly channel_id: string | null;
  readonly self_deaf: boolean;
  readonly self_mute: boolean;
}

interface VoiceStatePayload {
  readonly op: 4;
  readonly d: VoiceStateUpdate & { readonly guild_id: string };
}

type Networking = Extract<VoiceConnectionState, { networking: unknown }>["networking"];

export class DiscordVoiceSession implements VoiceSession {
  readonly guildId: string;
  readonly clientUserId: string;
  readonly #options: DiscordVoiceSessionOptions;
  readonly #connection: VoiceConnection;
  readonly #listeners = new Set<(event: VoiceSessionEvent) => void>();
  readonly #waiters = new Set<() => void>();
  #writes: Promise<void> = Promise.resolve();
  #gateway?: VoiceGatewayData;
  #published?: Networking;
  #voiceState?: VoiceStateUpdate;
  #moveTarget?: string;
  #deadline?: ReturnType<typeof setTimeout>;
  #resend?: ReturnType<typeof setInterval>;
  #failure?: Error;
  #leftSinceReady = false;
  #platformClosed = false;
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
      await session.#until(() => session.#gateway !== undefined, "Discord voice did not connect");
      if (signal?.aborted) throw joinAborted(signal);
    } catch (error) {
      await session.release().catch(() => undefined);
      throw signal?.aborted ? joinAborted(signal) : error;
    } finally {
      signal?.removeEventListener("abort", release);
    }
    return session;
  }

  static connectionOf(session: VoiceSession): VoiceConnection | undefined {
    return session instanceof DiscordVoiceSession && !session.#released ? session.#connection : undefined;
  }

  private constructor(options: DiscordVoiceSessionOptions) {
    this.#options = options;
    this.guildId = options.guildId;
    this.clientUserId = options.clientUserId;
    this.#connection = joinVoiceChannel({
      guildId: options.guildId,
      group: options.clientUserId,
      channelId: options.channelId,
      selfDeaf: options.selfDeaf,
      selfMute: options.selfMute,
      adapterCreator: methods =>
        options.adapterCreator({
          ...methods,
          onVoiceStateUpdate: state => {
            methods.onVoiceStateUpdate(state);
            this.#voiceState = state;
            this.#settle();
          },
        }),
    });
    this.#connection.on("error", () => undefined);
    this.#connection.on("stateChange", (previous, next) => this.#changed(previous, next));
    this.#changed(undefined, this.#connection.state);
  }

  get channelId(): string {
    return this.#voiceState?.channel_id ?? this.#gateway?.channelId ?? this.#options.channelId;
  }
  get bitrate(): number {
    return this.#options.channelBitrate(this.channelId);
  }
  get gateway(): VoiceGatewayData | undefined {
    return this.#gateway;
  }
  get selfDeaf(): boolean {
    return this.#voiceState?.self_deaf ?? this.#options.selfDeaf;
  }
  get selfMute(): boolean {
    return this.#voiceState?.self_mute ?? this.#options.selfMute;
  }

  join(channelId: string, options: JoinOptions = {}): Promise<void> {
    return this.#enqueue(() => this.#join(channelId, options));
  }
  setSelfState(state: JoinOptions): Promise<void> {
    return this.#enqueue(() => this.#join(this.channelId, state));
  }
  voiceClosed(): void {}
  rejoin(): Promise<void> {
    return this.#enqueue(async () => {
      await this.#untilReady();
      const channelId = this.channelId;
      const networking = this.#published;
      if (!this.#connection.disconnect()) throw gatewayUnavailable();
      this.#connection.rejoin({ channelId, selfDeaf: this.selfDeaf, selfMute: this.selfMute });
      await this.#until(() => this.#published !== networking, "Discord voice did not rejoin");
    });
  }
  subscribe(listener: (event: VoiceSessionEvent) => void): () => void {
    if (this.#released) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  release(): Promise<void> {
    this.#releasePromise ??= new Promise(resolve => {
      this.#released = true;
      this.#listeners.clear();
      this.#stopRecovery();
      for (const check of this.#waiters) check();
      if (this.#connection.state.status !== VoiceConnectionStatus.Destroyed) this.#connection.destroy();
      resolve();
    });
    return this.#releasePromise;
  }

  #enqueue(write: () => Promise<void>): Promise<void> {
    const run = this.#writes.then(write);
    this.#writes = run.catch(() => undefined);
    return run;
  }

  async #join(channelId: string, { selfDeaf = this.selfDeaf, selfMute = this.selfMute }: JoinOptions): Promise<void> {
    await this.#untilReady();
    const move = channelId !== this.channelId;
    if (move) this.#options.preflight(channelId);
    else if (selfDeaf === this.selfDeaf && selfMute === this.selfMute) return;
    const networking = this.#published;
    if (move) this.#moveTarget = channelId;
    try {
      // The library's own rejoin tears down a Ready socket when the gateway refuses, so the write goes out directly.
      if (!this.#sendState({ channel_id: channelId, self_deaf: selfDeaf, self_mute: selfMute }))
        throw gatewayUnavailable();
      await this.#until(
        () =>
          move
            ? this.#published !== networking && this.#gateway?.channelId === channelId
            : this.selfDeaf === selfDeaf && this.selfMute === selfMute,
        move ? "Discord voice did not move" : "Discord did not acknowledge the voice state",
      );
    } finally {
      this.#moveTarget = undefined;
      this.#settle();
    }
  }

  /** The library only accepts a write while Ready; any other state means its own join is in flight. */
  #untilReady(): Promise<void> {
    return this.#until(
      () => this.#connection.state.status === VoiceConnectionStatus.Ready,
      "Discord voice did not reconnect",
    );
  }

  #until(done: () => boolean, failure: string): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const finish = (): void => {
      clearTimeout(timer);
      this.#waiters.delete(check);
    };
    const check = (): void => {
      if (this.#released) {
        finish();
        reject(this.#failure ?? sessionReleased());
      } else if (done()) {
        finish();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`${failure} within ${this.#options.timeoutMs} ms`));
    }, this.#options.timeoutMs);
    this.#waiters.add(check);
    check();
    return promise;
  }

  #changed(previous: VoiceConnectionState | undefined, next: VoiceConnectionState): void {
    if (this.#released) return;
    const networking = networkingOf(next);
    // @discordjs/voice keeps close codes off the connection state, so read them before the library rejoins.
    if (networking && networking !== (previous && networkingOf(previous)))
      networking.prependOnceListener("close", (code: number) => this.#socketClosed(code));
    if (next.status === VoiceConnectionStatus.Destroyed) {
      this.#fail(new Error("Discord voice connection was destroyed outside DisTube"));
      return;
    }
    if (next.status === VoiceConnectionStatus.Ready) {
      this.#stopRecovery();
      this.#leftSinceReady = false;
      this.#platformClosed = false;
    } else
      this.#deadline ??= setTimeout(
        () => this.#fail(new Error(`Discord voice did not reach Ready within ${this.#options.timeoutMs} ms`)),
        this.#options.timeoutMs,
      );
    const refused =
      next.status === VoiceConnectionStatus.Disconnected &&
      next.reason === VoiceConnectionDisconnectReason.AdapterUnavailable;
    if (refused) this.#resend ??= setInterval(() => this.#leaveAndJoin(), RESEND_INTERVAL_MS);
    else {
      clearInterval(this.#resend);
      this.#resend = undefined;
    }
    this.#settle();
  }

  /** Discord sends no voice server update for a join to the held channel, so a recoverable close leaves before the library rejoins. */
  #socketClosed(code: number): void {
    if (this.#released) return;
    if (TERMINAL_CLOSE_CODES.has(code)) this.#fail(new Error(terminalCloseMessage(code, true)));
    else if (PLATFORM_CLOSE_CODES.has(code) || this.#voiceState?.channel_id === null) {
      this.#platformClosed = true;
      this.#settle();
    } else if (!this.#leftSinceReady) this.#leftSinceReady = this.#sendLeave();
  }

  #leaveAndJoin(): void {
    if (this.#platformClosed || this.#sendLeave())
      this.#connection.rejoin({ channelId: this.channelId, selfDeaf: this.selfDeaf, selfMute: this.selfMute });
  }

  #sendLeave(): boolean {
    return this.#sendState({ channel_id: null, self_deaf: this.selfDeaf, self_mute: this.selfMute });
  }

  #sendState(update: VoiceStateUpdate): boolean {
    const { state } = this.#connection;
    if (state.status === VoiceConnectionStatus.Destroyed) return false;
    const payload: VoiceStatePayload = { op: 4, d: { guild_id: this.guildId, ...update } };
    return state.adapter.sendPayload(payload);
  }

  #stopRecovery(): void {
    clearTimeout(this.#deadline);
    clearInterval(this.#resend);
    this.#deadline = undefined;
    this.#resend = undefined;
  }

  #settle(): void {
    if (this.#released) return;
    const { state } = this.#connection;
    if (this.#platformClosed && this.#voiceState?.channel_id === null) {
      this.#disconnect({ type: "disconnected", reason: "removed" });
      return;
    }
    const networking = networkingOf(state);
    const voice = networking?.state;
    const channelId = this.channelId;
    if (
      state.status === VoiceConnectionStatus.Ready &&
      voice &&
      "connectionOptions" in voice &&
      networking !== this.#published &&
      (this.#moveTarget === undefined || channelId === this.#moveTarget)
    ) {
      this.#published = networking;
      const { sessionId, token, endpoint } = voice.connectionOptions;
      const gateway = Object.freeze({ channelId, sessionId, token, endpoint });
      this.#gateway = gateway;
      for (const listener of this.#listeners) {
        try {
          listener({ type: "connected", channelId: gateway.channelId, gateway });
        } catch {}
      }
    }
    for (const check of this.#waiters) check();
  }

  #fail(error: Error): void {
    this.#failure = error;
    this.#disconnect({ type: "disconnected", reason: "failed", error });
  }

  #disconnect(event: Extract<VoiceSessionEvent, { type: "disconnected" }>): void {
    if (this.#released) return;
    const listeners = [...this.#listeners];
    void this.release().catch(() => undefined);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {}
    }
  }
}

export class DiscordGatewaySession implements VoiceSession {
  readonly guildId: string;
  readonly clientUserId: string;
  readonly #options: DiscordVoiceSessionOptions;
  readonly #gatewayAdapter: ReturnType<DiscordGatewayAdapterCreator>;
  readonly #listeners = new Set<(event: VoiceSessionEvent) => void>();
  readonly #waiters = new Set<() => void>();
  #writes: Promise<void> = Promise.resolve();
  #state?: Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceStateUpdate"]>[0];
  #server?: Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceServerUpdate"]>[0];
  #pairedServer?: Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceServerUpdate"]>[0];
  #moveTarget?: string;
  #channelId: string;
  #gateway?: VoiceGatewayData;
  #selfDeaf: boolean;
  #selfMute: boolean;
  #leaving = false;
  #rejoins: number[] = [];
  #platformDeadline?: ReturnType<typeof setTimeout>;
  #released = false;
  #releasePromise?: Promise<void>;

  static async connect(options: DiscordVoiceSessionOptions): Promise<DiscordGatewaySession> {
    const { signal } = options;
    if (signal?.aborted) throw joinAborted(signal);
    options.preflight(options.channelId);
    const session = new DiscordGatewaySession(options);
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

  private constructor(options: DiscordVoiceSessionOptions) {
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
          const acknowledged = this.#state !== undefined;
          this.#state = undefined;
          // Discord echoes the leave of the session this one replaced through the same per-guild adapter.
          if (acknowledged && !this.#leaving) this.#disconnect({ type: "disconnected", reason: "removed" });
          return;
        }
        if (
          this.#state &&
          (this.#state.channel_id !== state.channel_id || this.#state.session_id !== state.session_id)
        ) {
          this.#gateway = undefined;
          if (this.#server === this.#pairedServer) this.#server = undefined;
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

  join(channelId: string, options: JoinOptions = {}): Promise<void> {
    return this.#enqueue(() => this.#join(channelId, options));
  }
  setSelfState(state: JoinOptions): Promise<void> {
    return this.#enqueue(() => this.#join(this.#channelId, state));
  }
  voiceClosed(code: number): void {
    if (this.#released || this.#endedBy(code)) return;
    if (PLATFORM_CLOSE_CODES.has(code)) this.#awaitPlatform(code);
    else if (REJOIN_CLOSE_CODES.has(code) && this.#spendRejoin(code))
      this.#enqueue(() => this.#rejoin()).catch((error: unknown) => this.#terminate(asError(error)));
  }
  rejoin(): Promise<void> {
    return this.#enqueue(() => this.#rejoin()).catch((error: unknown) => {
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
    clearTimeout(this.#platformDeadline);
    this.#gateway = undefined;
    for (const check of this.#waiters) check();
    this.#listeners.clear();
    this.#releasePromise = this.#enqueue(async () => {
      const failures: unknown[] = [];
      for (const action of [
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
    this.#moveTarget = channelId;
    try {
      await this.#request(
        { channel_id: channelId, self_deaf: selfDeaf, self_mute: selfMute },
        () => this.#gateway?.channelId === channelId && this.#selfDeaf === selfDeaf && this.#selfMute === selfMute,
      );
    } finally {
      this.#moveTarget = undefined;
    }
  }

  /** Discord sends no voice server update for a join to the held channel, so the leave goes first. */
  async #rejoin(): Promise<void> {
    if (this.#released) throw sessionReleased();
    const channelId = this.#channelId;
    const flags = { self_deaf: this.#selfDeaf, self_mute: this.#selfMute };
    this.#server = undefined;
    this.#gateway = undefined;
    this.#leaving = true;
    try {
      await this.#request({ channel_id: null, ...flags }, () => true, true);
      await this.#request({ channel_id: channelId, ...flags }, () => this.#gateway?.channelId === channelId, true);
    } finally {
      this.#leaving = false;
    }
  }

  #request(update: VoiceStateUpdate, acknowledged: () => boolean, resend = false): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let resending: ReturnType<typeof setInterval> | undefined;
    let sent = false;
    const finish = (): void => {
      clearTimeout(timer);
      clearInterval(resending);
      this.#waiters.delete(check);
    };
    const fail = (error: unknown): void => {
      finish();
      reject(error);
    };
    const check = (): void => {
      if (this.#released) fail(sessionReleased());
      else if (sent && acknowledged()) {
        finish();
        resolve();
      }
    };
    const timer = setTimeout(() => fail(new Error("Discord gateway membership timed out")), this.#options.timeoutMs);
    this.#waiters.add(check);
    const send = (): boolean => {
      if (!this.#sendUpdate(update)) return false;
      sent = true;
      check();
      return true;
    };
    try {
      if (send()) return promise;
      if (!resend) fail(gatewayUnavailable());
      else
        resending = setInterval(() => {
          try {
            if (this.#released || send()) clearInterval(resending);
          } catch (error) {
            fail(error);
          }
        }, RESEND_INTERVAL_MS);
    } catch (error) {
      fail(error);
    }
    return promise;
  }

  /** Discord never answers a join it refuses, so a refused target would otherwise wait out the join deadline. */
  #sendUpdate(update: VoiceStateUpdate): boolean {
    if (update.channel_id !== null && update.channel_id !== this.#channelId) this.#options.preflight(update.channel_id);
    const payload: VoiceStatePayload = { op: 4, d: { guild_id: this.guildId, ...update } };
    return this.#gatewayAdapter.sendPayload(payload);
  }

  #awaitPlatform(code: number): void {
    clearTimeout(this.#platformDeadline);
    this.#platformDeadline = setTimeout(
      () =>
        this.#terminate(
          new Error(`Discord voice closed with code ${code} and did not move within ${this.#options.timeoutMs} ms`),
        ),
      this.#options.timeoutMs,
    );
  }

  #endedBy(code: number): boolean {
    if (!TERMINAL_CLOSE_CODES.has(code)) return false;
    this.#terminate(new Error(terminalCloseMessage(code, false)));
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

  #terminate(error: Error): void {
    this.#disconnect({ type: "disconnected", reason: "failed", error });
  }

  #disconnect(event: Extract<VoiceSessionEvent, { type: "disconnected" }>): void {
    if (this.#released) return;
    const listeners = [...this.#listeners];
    void this.release().catch(() => undefined);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  #settle(): void {
    const state = this.#state;
    const server = this.#server;
    if (!state?.channel_id || !state.session_id || !server?.endpoint || !server.token) return;
    if (this.#moveTarget !== undefined && state.channel_id !== this.#moveTarget) return;
    this.#pairedServer = server;
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
    clearTimeout(this.#platformDeadline);
    this.#platformDeadline = undefined;
    for (const listener of this.#listeners) {
      try {
        listener({ type: "connected", channelId: this.channelId, gateway });
      } catch {}
    }
  }
}

function networkingOf(state: VoiceConnectionState): Networking | undefined {
  return "networking" in state ? state.networking : undefined;
}

function joinAborted(signal: AbortSignal): DisTubeError {
  return new DisTubeError("ABORTED", "Voice join was aborted", { cause: signal.reason });
}

function terminalCloseMessage(code: number, builtIn: boolean): string {
  if (code !== DAVE_REQUIRED_CLOSE_CODE) return `Discord voice closed with code ${code}`;
  const library = builtIn ? ", which needs @discordjs/voice 0.19.1 or newer" : "";
  return `Discord voice closed with code ${code}: the channel requires DAVE end-to-end encryption${library}`;
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
