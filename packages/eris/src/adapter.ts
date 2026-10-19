import type { FfmpegFilterDefinitions } from "@distube/voice-core/core";
import type { Adapter, Engine, JoinOptions, VoiceSession, VoiceTarget } from "distube/integrations";
import type { Client, VoiceChannel } from "eris";
import { ErisVoiceEngine, erisPreflight } from "./engine";
import { ErisVoiceSession } from "./session";

export interface ErisAdapterOptions {
  readonly connectionTimeoutMs?: number;
  /** Filter presets merged over the engine's built-in filter defaults. */
  readonly filters?: FfmpegFilterDefinitions;
}

export class ErisAdapter implements Adapter<VoiceChannel> {
  readonly engine: Engine;
  readonly #client: Client;
  readonly #timeout: number;
  readonly #preflight: () => Promise<void>;

  constructor(client: Client, options: ErisAdapterOptions = {}) {
    if (!client) throw new TypeError("ErisAdapter requires an Eris Client");
    this.#client = client;
    this.#timeout = positiveInteger(options.connectionTimeoutMs ?? 15_000, "connectionTimeoutMs");
    this.#preflight = erisPreflight("@distube/eris");
    this.engine = new ErisVoiceEngine(options.filters, this.#preflight);
  }

  normalizeTarget(channel: VoiceChannel): VoiceTarget {
    const guildID = Reflect.get(channel, "guildID");
    if (typeof guildID === "string" && guildID !== channel.guild.id) {
      throw new TypeError("Eris channel has conflicting guild identities");
    }
    return { guildId: channel.guild.id, channelId: channel.id };
  }

  async createVoiceSession(target: VoiceTarget, options: JoinOptions = {}): Promise<VoiceSession> {
    ErisVoiceSession.assertTarget(this.#client, target.guildId, target.channelId);
    const clientUserId = this.#client.user?.id;
    if (!clientUserId) throw new Error("Eris client user is unavailable");
    return ErisVoiceSession.connect({
      client: this.#client,
      guildId: target.guildId,
      channelId: target.channelId,
      clientUserId,
      selfDeaf: options.selfDeaf ?? true,
      selfMute: options.selfMute ?? false,
      connectionTimeoutMs: this.#timeout,
    });
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}
