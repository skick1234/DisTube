import type { AudioPlayer, VoiceConnection } from "@discordjs/voice";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  type DiscordGatewayAdapterCreator,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import type { Client } from "discord.js";
import type { Adapter, PlaybackRequest, Player, PlayerEvent, QueueBinding } from "distube";

export interface DiscordJSAdapterOptions {
  readonly connectionTimeoutMs?: number;
}

class DiscordJSPlayer implements Player {
  readonly #connection: VoiceConnection;
  readonly #player: AudioPlayer;
  readonly #listeners = new Set<(event: PlayerEvent) => void>();
  #itemId?: string;
  #terminal = false;
  #stopPromise?: Promise<void>;

  constructor(connection: VoiceConnection) {
    this.#connection = connection;
    this.#player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(this.#player);
    connection.on("stateChange", this.#onConnectionStateChange);
    this.#player.on(AudioPlayerStatus.Idle, () => {
      if (this.#terminal) return;
      const itemId = this.#itemId;
      this.#itemId = undefined;
      if (itemId) this.#emit({ type: "finished", itemId });
    });
    this.#player.on("error", error => {
      if (this.#terminal) return;
      const itemId = this.#itemId;
      this.#itemId = undefined;
      if (itemId) this.#emit({ type: "failed", itemId, error });
    });
  }

  async play(value: PlaybackRequest): Promise<void> {
    if (this.#terminal) throw new Error("Discord Player is stopped");
    if (this.#itemId) throw new Error("Discord Player already has active playback");
    const request = playbackRequest(value);
    this.#itemId = request.itemId;
    this.#player.play(createAudioResource(request.resource.url));
    await entersState(this.#player, AudioPlayerStatus.Playing, 15_000);
  }

  async pause(): Promise<void> {
    if (!this.#player.pause(true)) throw new Error("Discord audio player could not pause");
  }

  async resume(): Promise<void> {
    if (!this.#player.unpause()) throw new Error("Discord audio player could not resume");
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#terminal = true;
    this.#itemId = undefined;
    this.#listeners.clear();
    this.#stopPromise = cleanupAll([
      () => this.#player.stop(true),
      () => this.#player.removeAllListeners(),
      () => this.#connection.off("stateChange", this.#onConnectionStateChange),
      () => {
        if (this.#connection.state.status !== VoiceConnectionStatus.Destroyed) this.#connection.destroy();
      },
    ]);
    return this.#stopPromise;
  }

  async seek(_seconds: number): Promise<void> {
    throw new Error("Seeking is not supported by the discord.js Player");
  }

  subscribe(listener: (event: PlayerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  readonly #onConnectionStateChange = (
    _oldState: VoiceConnection["state"],
    newState: VoiceConnection["state"],
  ): void => {
    if (this.#terminal || newState.status !== VoiceConnectionStatus.Destroyed) return;
    const itemId = this.#itemId;
    this.#itemId = undefined;
    this.#terminal = true;
    if (itemId) {
      this.#emit(
        { type: "failed", itemId, error: new Error("Discord voice connection was destroyed"), terminal: true },
        true,
      );
    }
  };

  #emit(event: PlayerEvent, terminalOutcome = false): void {
    if (this.#terminal && !terminalOutcome) return;
    for (const listener of this.#listeners) listener(event);
  }
}

async function cleanupAll(operations: readonly (() => unknown)[]): Promise<void> {
  const failures: Error[] = [];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error: unknown) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Discord Player cleanup failures");
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

export class DiscordJSAdapter implements Adapter {
  readonly #client: Client;
  readonly #timeout: number;

  constructor(client: Client, options: DiscordJSAdapterOptions = {}) {
    if (!client) throw new TypeError("DiscordJSAdapter requires a discord.js Client");
    const timeout = options.connectionTimeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1) throw new TypeError("connectionTimeoutMs must be positive");
    this.#client = client;
    this.#timeout = timeout;
  }

  async createPlayer(binding: QueueBinding): Promise<Player> {
    const guild = this.#client.guilds.cache.get(binding.guildId);
    if (!guild) throw new Error(`Discord guild is unavailable: ${binding.guildId}`);
    const connection = joinVoiceChannel({
      guildId: binding.guildId,
      channelId: binding.channelId,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, this.#timeout);
      return new DiscordJSPlayer(connection);
    } catch (error: unknown) {
      connection.destroy();
      throw error;
    }
  }
}
