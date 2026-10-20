/**
 * Platform-neutral half of @distube/voice-core: in-process decoding, filter rendering, prerequisite
 * probes, and cleanup helpers shared by every official adapter.
 *
 * The `@discordjs/voice`-specific session, engine, and player live behind `./discord`.
 */
export { asError } from "./cleanup";
export { DEFAULT_FILTERS, type FfmpegFilterDefinition, type FfmpegFilterDefinitions, FilterRegistry } from "./filters";
export {
  createPrerequisiteCheck,
  DISCORD_ENCRYPTION_MODULES,
  ERIS_ENCRYPTION_MODULES,
  type PrerequisiteModules,
  type PrerequisiteRuntime,
} from "./prerequisites";
export { Track, type TrackOutcome, type TrackSettings } from "./track";
export { type LocalPlaybackResource, localPlaybackResource, playbackRequest } from "./validation";
