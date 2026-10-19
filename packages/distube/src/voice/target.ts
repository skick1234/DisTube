import type { Adapter, VoiceTarget } from "../contracts";
import { asError, DisTubeError, ErrorCode } from "../errors";

/** Identity shared by supported native platform voice channels. */
export type VoiceChannelTarget = { readonly id: string } & (
  | { readonly guildId: string }
  | { readonly guild: { readonly id: string } }
);

/** Adapter normalization plus core ID validation, shared by play, join and move. */
export function normalizeTarget<Target>(adapter: Adapter<Target>, target: Target): VoiceTarget {
  let normalized: VoiceTarget;
  try {
    normalized = adapter.normalizeTarget(target);
  } catch (error: unknown) {
    // Whatever the Adapter throws for a native target it cannot read, the caller passed bad input.
    if (DisTubeError.is(error, ErrorCode.INVALID_ARGUMENT)) throw error;
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Voice target could not be normalized", {
      cause: asError(error),
    });
  }
  validateTarget(normalized);
  return Object.freeze({ guildId: normalized.guildId, channelId: normalized.channelId });
}

export function validateTarget(target: VoiceTarget): void {
  if (!target || typeof target.guildId !== "string" || target.guildId.length === 0) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "guildId must be a non-empty string");
  }
  if (typeof target.channelId !== "string" || target.channelId.length === 0) {
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "channelId must be a non-empty string");
  }
}
