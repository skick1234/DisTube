import type { Adapter, VoiceTarget } from "../contracts";
import { DisTubeError, ErrorCode } from "../errors";

/** Identity shared by supported native platform voice channels. */
export type VoiceChannelTarget = { readonly id: string } & (
  | { readonly guildId: string }
  | { readonly guild: { readonly id: string } }
);

export function normalizeTarget<Target>(adapter: Adapter<Target>, target: Target): VoiceTarget {
  let normalized: VoiceTarget;
  try {
    normalized = adapter.normalizeTarget(target);
  } catch (error: unknown) {
    if (DisTubeError.is(error, ErrorCode.INVALID_ARGUMENT)) throw error;
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Voice target could not be normalized", { cause: error });
  }
  const { guildId, channelId } = normalized;
  return Object.freeze({ guildId: requireId(guildId, "guildId"), channelId: requireId(channelId, "channelId") });
}

function requireId(id: unknown, name: string): string {
  if (typeof id !== "string" || id.length === 0)
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${name} must be a non-empty string`);
  return id;
}
