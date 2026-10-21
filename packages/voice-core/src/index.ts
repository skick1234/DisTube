/**
 * Platform-neutral half of @distube/voice-core: the filter vocabulary shared by every official adapter.
 *
 * The `@discordjs/voice`-specific session, engine, and player live behind `./discord`.
 */
export { DEFAULT_FILTERS, type FfmpegFilterDefinition, type FfmpegFilterDefinitions } from "./filters";
