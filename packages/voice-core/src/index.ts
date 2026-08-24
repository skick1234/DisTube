/**
 * Platform-neutral half of @distube/voice-core: ffmpeg decoding, filter rendering, prerequisite
 * probes, and cleanup helpers shared by every official adapter.
 *
 * The `@discordjs/voice`-specific session, engine, and player live behind `./discord`.
 */
export { asError, cleanupAll, collectCleanupFailures } from "./cleanup";
export type { FfmpegOutcome, FfmpegStream } from "./ffmpeg";
export {
  ffmpegCommand,
  ffmpegFailure,
  finishedFfmpeg,
  killFfmpeg,
  spawnFfmpeg,
} from "./ffmpeg";
export {
  type FfmpegFilterDefinitions,
  FilterRegistry,
} from "./filters";
export {
  createPrerequisiteCheck,
  DISCORD_ENCRYPTION_MODULES,
  DISCORD_OPUS_MODULES,
  ERIS_ENCRYPTION_MODULES,
  ERIS_OPUS_MODULES,
  type PrerequisiteModules,
  type PrerequisiteRuntime,
} from "./prerequisites";
export { playbackRequest, type UrlPlaybackRequest } from "./validation";
