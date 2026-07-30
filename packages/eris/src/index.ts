import type { Adapter, PlaybackRequest, Player, PlayerEvent, QueueBinding } from "distube";
import type { Client, VoiceConnection } from "eris";

export interface ErisAdapterOptions {
  readonly connectionTimeoutMs?: number;
  readonly selfDeaf?: boolean;
  readonly selfMute?: boolean;
}

interface ActivePlayback {
  readonly generation: number;
  readonly itemId: string;
  readonly resolveStart: () => void;
  readonly rejectStart: (error: Error) => void;
  startTimer: ReturnType<typeof setTimeout>;
  started: boolean;
  terminal: boolean;
}

function objectRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" ? (value as Readonly<Record<string, unknown>>) : undefined;
}

function voiceChannelGuildId(channel: unknown): string | undefined {
  const record = objectRecord(channel);
  if (!record || typeof record.join !== "function") return undefined;
  const guild = objectRecord(record.guild);
  return typeof guild?.id === "string" ? guild.id : undefined;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be positive`);
  return value;
}

class ErisPlayer implements Player {
  readonly #client: Client;
  readonly #connection: VoiceConnection;
  readonly #channelId: string;
  readonly #timeout: number;
  readonly #listeners = new Set<(event: PlayerEvent) => void>();
  #active?: ActivePlayback;
  #generation = 0;
  #disposed = false;
  #disconnected = false;
  #stopResolve?: () => void;
  #stopPromise?: Promise<void>;

  constructor(client: Client, connection: VoiceConnection, channelId: string, timeout: number) {
    this.#client = client;
    this.#connection = connection;
    this.#channelId = channelId;
    this.#timeout = timeout;
    connection.on("start", this.#onStart);
    connection.on("end", this.#onEnd);
    connection.on("error", this.#onError);
    connection.on("disconnect", this.#onDisconnect);
  }

  play(value: PlaybackRequest): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error("Eris Player is stopped"));
    if (this.#active) return Promise.reject(new Error("Eris Player already has active playback"));
    let request: PlaybackRequest;
    try {
      request = playbackRequest(value);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    const generation = ++this.#generation;
    return new Promise<void>((resolve, reject) => {
      const active: ActivePlayback = {
        generation,
        itemId: request.itemId,
        resolveStart: resolve,
        rejectStart: reject,
        startTimer: setTimeout(() => {
          if (this.#active?.generation !== generation || active.started) return;
          active.terminal = true;
          this.#active = undefined;
          this.#connection.stopPlaying();
          reject(new Error("Eris playback start timed out"));
        }, this.#timeout),
        started: false,
        terminal: false,
      };
      this.#active = active;
      try {
        this.#connection.play(request.resource.url);
      } catch (cause: unknown) {
        clearTimeout(active.startTimer);
        active.terminal = true;
        this.#active = undefined;
        reject(cause instanceof Error ? cause : new Error("Eris playback failed to start", { cause }));
      }
    });
  }

  async pause(): Promise<void> {
    this.#assertActive();
    this.#connection.pause();
  }

  async resume(): Promise<void> {
    this.#assertActive();
    this.#connection.resume();
  }

  stop(): Promise<void> {
    this.#stopPromise ??= this.#performStop();
    return this.#stopPromise;
  }

  async #performStop(): Promise<void> {
    this.#disposed = true;
    const failures: Error[] = [];
    const active = this.#active;
    this.#active = undefined;
    if (active) {
      clearTimeout(active.startTimer);
      active.terminal = true;
      if (!active.started) active.rejectStart(new Error("Eris playback was stopped before start"));
    }

    try {
      if (this.#connection.playing && !this.#disconnected) {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            this.#stopResolve = undefined;
            resolve();
          };
          const timer = setTimeout(finish, this.#timeout);
          this.#stopResolve = finish;
          try {
            this.#connection.stopPlaying();
          } catch (error: unknown) {
            clearTimeout(timer);
            this.#stopResolve = undefined;
            reject(error);
          }
        });
      } else {
        this.#connection.stopPlaying();
      }
    } catch (error: unknown) {
      failures.push(asError(error));
    }

    for (const operation of [
      () => this.#detachNativeListeners(),
      () => this.#listeners.clear(),
      () => this.#client.leaveVoiceChannel(this.#channelId),
    ]) {
      try {
        operation();
      } catch (error: unknown) {
        failures.push(asError(error));
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Eris Player cleanup failures");
  }

  async seek(_seconds: number): Promise<void> {
    throw new Error("Seeking is not supported by the Eris Player");
  }

  subscribe(listener: (event: PlayerEvent) => void): () => void {
    if (this.#disposed) return () => undefined;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  readonly #onStart = (): void => {
    const active = this.#active;
    if (!active || active.terminal || active.started) return;
    active.started = true;
    clearTimeout(active.startTimer);
    active.resolveStart();
  };

  readonly #onEnd = (): void => {
    if (this.#stopResolve) {
      this.#stopResolve();
      return;
    }
    const active = this.#active;
    if (!active || active.terminal) return;
    if (!active.started) {
      clearTimeout(active.startTimer);
      active.terminal = true;
      this.#active = undefined;
      active.rejectStart(new Error("Eris playback ended before start"));
      return;
    }
    this.#finish(active, { type: "finished", itemId: active.itemId });
  };

  readonly #onError = (error: Error): void => {
    const active = this.#active;
    if (!active || active.terminal) return;
    if (!active.started) {
      clearTimeout(active.startTimer);
      active.terminal = true;
      this.#active = undefined;
      active.rejectStart(error);
      return;
    }
    this.#finish(active, { type: "failed", itemId: active.itemId, error });
  };

  readonly #onDisconnect = (error?: Error): void => {
    if (this.#stopResolve) {
      this.#stopResolve();
      return;
    }
    const active = this.#active;
    this.#disconnected = true;
    if (!active || active.terminal) {
      this.#disposed = true;
      void this.stop().catch(() => undefined);
      return;
    }
    const failure = error ?? new Error("Eris voice connection disconnected");
    this.#disposed = true;
    if (!active.started) {
      clearTimeout(active.startTimer);
      active.terminal = true;
      this.#active = undefined;
      active.rejectStart(failure);
      void this.stop().catch(() => undefined);
      return;
    }
    this.#finish(active, { type: "failed", itemId: active.itemId, error: failure, terminal: true });
    void this.stop().catch(() => undefined);
  };

  #finish(active: ActivePlayback, event: PlayerEvent): void {
    if (this.#active?.generation !== active.generation || active.terminal) return;
    active.terminal = true;
    this.#active = undefined;
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // Player listeners are isolated; GuildQueue remains the state and diagnostic authority.
      }
    }
  }

  #assertActive(): void {
    if (this.#disposed || !this.#active?.started) throw new Error("Eris Player has no active playback");
  }

  #detachNativeListeners(): void {
    this.#connection.off("start", this.#onStart);
    this.#connection.off("end", this.#onEnd);
    this.#connection.off("error", this.#onError);
    this.#connection.off("disconnect", this.#onDisconnect);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function playbackRequest(value: unknown): PlaybackRequest {
  if (!value || typeof value !== "object") throw new TypeError("Playback request must be an object");
  const request = value as Readonly<Record<string, unknown>>;
  const resource = request.resource;
  if (Object.keys(request).length !== 2 || typeof request.itemId !== "string" || request.itemId.length === 0) {
    throw new TypeError("Playback request must contain only itemId and resource");
  }
  if (!resource || typeof resource !== "object") throw new TypeError("Playback resource must be a URL resource");
  const candidate = resource as Readonly<Record<string, unknown>>;
  if (candidate.kind !== "url" || typeof candidate.url !== "string" || typeof candidate.dispose !== "function") {
    throw new TypeError("Playback resource must be a valid URL resource");
  }
  try {
    const url = new URL(candidate.url);
    if (!(["http:", "https:"] as const).includes(url.protocol as "http:" | "https:") || !url.hostname)
      throw new Error();
  } catch {
    throw new TypeError("Playback resource must contain an absolute HTTP(S) URL");
  }
  return value as PlaybackRequest;
}

export class ErisAdapter implements Adapter {
  readonly #client: Client;
  readonly #timeout: number;
  readonly #selfDeaf: boolean;
  readonly #selfMute: boolean;

  constructor(client: Client, options: ErisAdapterOptions = {}) {
    if (!client) throw new TypeError("ErisAdapter requires an Eris Client");
    this.#client = client;
    this.#timeout = positiveInteger(options.connectionTimeoutMs ?? 15_000, "connectionTimeoutMs");
    if (options.selfDeaf !== undefined && typeof options.selfDeaf !== "boolean") {
      throw new TypeError("selfDeaf must be boolean");
    }
    if (options.selfMute !== undefined && typeof options.selfMute !== "boolean") {
      throw new TypeError("selfMute must be boolean");
    }
    this.#selfDeaf = options.selfDeaf ?? true;
    this.#selfMute = options.selfMute ?? false;
  }

  async createPlayer(binding: QueueBinding): Promise<Player> {
    const channel = this.#client.getChannel(binding.channelId);
    const guildId = voiceChannelGuildId(channel);
    if (!guildId) throw new Error(`Eris voice channel is unavailable: ${binding.channelId}`);
    if (guildId !== binding.guildId) {
      throw new Error(`Eris voice channel ${binding.channelId} does not belong to guild ${binding.guildId}`);
    }

    const join = this.#client.joinVoiceChannel(binding.channelId, {
      selfDeaf: this.#selfDeaf,
      selfMute: this.#selfMute,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const connection = await Promise.race([
        join,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Eris voice connection timed out")), this.#timeout);
        }),
      ]);
      return new ErisPlayer(this.#client, connection, binding.channelId, this.#timeout);
    } catch (error: unknown) {
      this.#client.leaveVoiceChannel(binding.channelId);
      void join.then(
        () => this.#client.leaveVoiceChannel(binding.channelId),
        () => undefined,
      );
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
