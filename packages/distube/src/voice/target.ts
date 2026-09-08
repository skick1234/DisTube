import type { VoiceTarget } from "../contracts";
import { DisTubeError } from "../errors";

/** Identity shared by supported native platform voice channels. */
export type VoiceChannelTarget = { readonly id: string } & (
  | { readonly guildId: string }
  | { readonly guild: { readonly id: string } }
);

export function normalizeChannel(channel: VoiceChannelTarget): VoiceTarget {
  if (!channel || typeof channel !== "object") throw invalid();
  const direct = "guildId" in channel ? channel.guildId : undefined;
  const nested =
    "guild" in channel && channel.guild && typeof channel.guild === "object" ? channel.guild.id : undefined;
  if (!valid(channel.id) || (!valid(direct) && !valid(nested))) throw invalid();
  if ("guildId" in channel && !valid(direct)) throw invalid();
  if ("guild" in channel && !valid(nested)) throw invalid();
  if (direct !== undefined && nested !== undefined && direct !== nested) throw invalid();
  return Object.freeze({ guildId: (direct ?? nested) as string, channelId: channel.id });
}

function valid(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

function invalid(): DisTubeError {
  return new DisTubeError("INVALID_ARGUMENT", "Voice channel must have consistent non-empty channel and guild IDs");
}
