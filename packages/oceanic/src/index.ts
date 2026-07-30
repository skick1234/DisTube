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
import type { Adapter, PlaybackRequest, Player, PlayerEvent, QueueBinding } from "distube";
import type { Client } from "oceanic.js";

export interface OceanicAdapterOptions {
  readonly connectionTimeoutMs?: number;
  readonly playerFactory?: (binding: QueueBinding) => Promise<Player>;
}

class OceanicPlayer implements Player {
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
    if (this.#terminal) throw new Error("Oceanic Player is stopped");
    if (this.#itemId) throw new Error("Oceanic Player already has active playback");
    const request = playbackRequest(value);
    this.#itemId = request.itemId;
    this.#player.play(createAudioResource(request.resource.url));
    await entersState(this.#player, AudioPlayerStatus.Playing, 15_000);
  }
  async pause(): Promise<void> {
    if (!this.#player.pause(true)) throw new Error("Oceanic audio player could not pause");
  }
  async resume(): Promise<void> {
    if (!this.#player.unpause()) throw new Error("Oceanic audio player could not resume");
  }
  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#terminal = true;
    this.#itemId = undefined;
    this.#listeners.clear();
    this.#stopPromise = Promise.resolve().then(() => {
      this.#player.stop(true);
      this.#player.removeAllListeners();
      if (this.#connection.state.status !== VoiceConnectionStatus.Destroyed) this.#connection.destroy();
    });
    return this.#stopPromise;
  }
  async seek(_seconds: number): Promise<void> {
    throw new Error("Seeking is not supported by the Oceanic Player");
  }
  subscribe(listener: (event: PlayerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #emit(event: PlayerEvent): void {
    if (this.#terminal) return;
    for (const listener of this.#listeners) listener(event);
  }
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

export class OceanicAdapter implements Adapter {
  readonly #client: Client;
  readonly #timeout: number;
  readonly #factory?: (binding: QueueBinding) => Promise<Player>;

  constructor(client: Client, options: OceanicAdapterOptions = {}) {
    if (!client) throw new TypeError("OceanicAdapter requires an Oceanic Client");
    const timeout = options.connectionTimeoutMs ?? 15_000;
    if (!Number.isInteger(timeout) || timeout < 1) throw new TypeError("connectionTimeoutMs must be positive");
    this.#client = client;
    this.#timeout = timeout;
    this.#factory = options.playerFactory;
  }

  async createPlayer(binding: QueueBinding): Promise<Player> {
    if (this.#factory) return this.#factory(binding);
    const guild = this.#client.guilds.get(binding.guildId);
    if (!guild) throw new Error(`Oceanic guild is unavailable: ${binding.guildId}`);
    const adapterCreator = Reflect.get(guild, "voiceAdapterCreator");
    if (typeof adapterCreator !== "function") throw new Error("Oceanic guild does not expose a voice adapter creator");
    const connection = joinVoiceChannel({
      guildId: binding.guildId,
      channelId: binding.channelId,
      adapterCreator: adapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, this.#timeout);
      return new OceanicPlayer(connection);
    } catch (error: unknown) {
      connection.destroy();
      throw error;
    }
  }
}

export function createOceanicAdapter(client: Client, options?: OceanicAdapterOptions): OceanicAdapter {
  return new OceanicAdapter(client, options);
}
