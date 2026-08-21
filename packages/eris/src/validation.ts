import { DisTubeError, ErrorCode, type PlaybackRequest, type UrlPlaybackResource } from "distube";
import type { Client } from "eris";

/** A playback request narrowed to the `url` resource kind this engine accepts. */
export type UrlPlaybackRequest = PlaybackRequest & { readonly resource: UrlPlaybackResource };

export function objectRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" ? (value as Readonly<Record<string, unknown>>) : undefined;
}

export function voiceChannelGuildId(channel: unknown): string | undefined {
  const record = objectRecord(channel);
  if (!record || typeof record.join !== "function") return undefined;
  const guild = objectRecord(record.guild);
  return typeof guild?.id === "string" ? guild.id : undefined;
}

/** Rejects a missing, non-voice, or foreign-guild channel before any gateway work runs. */
export function assertGuildVoiceChannel(client: Client, guildId: string, channelId: string): void {
  const owner = voiceChannelGuildId(client.getChannel(channelId));
  if (!owner) throw new Error(`Eris voice channel is unavailable: ${channelId}`);
  if (owner !== guildId) throw new Error(`Eris voice channel ${channelId} does not belong to guild ${guildId}`);
}

export function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be positive`);
  return value;
}

export function playbackRequest(value: unknown): UrlPlaybackRequest {
  if (!value || typeof value !== "object") throw new TypeError("Playback request must be an object");
  const request = value as Readonly<Record<string, unknown>>;
  const resource = request.resource;
  if (Object.keys(request).length !== 2 || typeof request.itemId !== "string" || request.itemId.length === 0) {
    throw new TypeError("Playback request must contain only itemId and resource");
  }
  if (!resource || typeof resource !== "object") throw new TypeError("Playback resource must be a URL resource");
  const candidate = resource as Readonly<Record<string, unknown>>;
  // An engine that cannot perform a kind says so in its own words, which is what keeps UNSUPPORTED honest.
  if (candidate.kind === "encoded") {
    throw new DisTubeError(ErrorCode.UNSUPPORTED, "The default voice engine cannot play encoded resources");
  }
  if (candidate.kind !== "url" || typeof candidate.url !== "string" || typeof candidate.dispose !== "function") {
    throw new TypeError("Playback resource must be a valid URL resource");
  }
  try {
    const url = new URL(candidate.url);
    if (!(<const>["http:", "https:"]).includes(url.protocol as "http:" | "https:") || !url.hostname) throw new Error();
  } catch {
    throw new TypeError("Playback resource must contain an absolute HTTP(S) URL");
  }
  return value as UrlPlaybackRequest;
}
