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
import type { Adapter, Player, PlayerEvent, QueueBinding, QueueItem } from "distube";
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

  constructor(connection: VoiceConnection) {
    this.#connection = connection;
    this.#player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    connection.subscribe(this.#player);
    this.#player.on(AudioPlayerStatus.Idle, () => {
      const itemId = this.#itemId;
      this.#itemId = undefined;
      if (itemId) this.#emit({ type: "finished", itemId });
    });
    this.#player.on("error", error => {
      const itemId = this.#itemId;
      this.#itemId = undefined;
      if (itemId) this.#emit({ type: "failed", itemId, error });
    });
  }

  async play(item: QueueItem): Promise<void> {
    this.#itemId = item.id;
    this.#player.play(createAudioResource(item.song.url));
    await entersState(this.#player, AudioPlayerStatus.Playing, 15_000);
  }
  async pause(): Promise<void> {
    if (!this.#player.pause(true)) throw new Error("Oceanic audio player could not pause");
  }
  async resume(): Promise<void> {
    if (!this.#player.unpause()) throw new Error("Oceanic audio player could not resume");
  }
  async stop(): Promise<void> {
    this.#itemId = undefined;
    this.#player.stop(true);
    if (this.#connection.state.status !== VoiceConnectionStatus.Destroyed) this.#connection.destroy();
  }
  async seek(_seconds: number): Promise<void> {
    throw new Error("Seeking is not supported by the Oceanic Player");
  }
  subscribe(listener: (event: PlayerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #emit(event: PlayerEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
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
