/**
 * The `@discordjs/voice`-specific half of @distube/voice-core, shared by @distube/discordjs and
 * @distube/oceanic. The platform-neutral pieces it builds on come from this package's root entry.
 */
export { DiscordVoiceEngine, discordPreflight } from "./engine";
export type { FfmpegFilterDefinition, FfmpegFilterDefinitions } from "./filters";
export { DiscordVoiceSession, type DiscordVoiceSessionOptions } from "./session";
