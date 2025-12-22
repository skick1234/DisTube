import type { DisTubeOptions, Filters } from "./type";

export const version: string = "[VI]{{inject}}[/VI]";

/**
 * Audio configuration constants
 */
export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;

/**
 * Default volume percentage (0-100)
 */
export const DEFAULT_VOLUME = 50;

/**
 * Timeout constants (in milliseconds)
 */
export const JOIN_TIMEOUT_MS = 30_000;
export const RECONNECT_TIMEOUT_MS = 5_000;
export const RECONNECT_MAX_ATTEMPTS = 5;

/**
 * HTTP redirect status codes
 */
export const HTTP_REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
export const MAX_REDIRECT_DEPTH = 5;

/**
 * Default DisTube audio filters.
 */
export const defaultFilters: Filters = {
  "3d": "apulsator=hz=0.125",
  bassboost: "bass=g=10",
  echo: "aecho=0.8:0.9:1000:0.3",
  flanger: "flanger",
  gate: "agate",
  haas: "haas",
  karaoke: "stereotools=mlev=0.1",
  nightcore: "asetrate=48000*1.25,aresample=48000,bass=g=5",
  reverse: "areverse",
  vaporwave: "asetrate=48000*0.8,aresample=48000,atempo=1.1",
  mcompand: "mcompand",
  phaser: "aphaser",
  tremolo: "tremolo",
  surround: "surround",
  earwax: "earwax",
};

export const defaultOptions = {
  plugins: [],
  emitNewSongOnly: false,
  savePreviousSongs: true,
  nsfw: false,
  emitAddSongWhenCreatingQueue: true,
  emitAddListWhenCreatingQueue: true,
  joinNewVoiceChannel: true,
} satisfies DisTubeOptions;
