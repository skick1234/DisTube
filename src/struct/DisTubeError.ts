import { inspect } from "node:util";

const ERROR_MESSAGES = {
  INVALID_TYPE: (expected: (number | string) | readonly (number | string)[], got: any, name?: string) =>
    `Expected ${
      Array.isArray(expected) ? expected.map(e => (typeof e === "number" ? e : `'${e}'`)).join(" or ") : `'${expected}'`
    }${name ? ` for '${name}'` : ""}, but got ${inspect(got)} (${typeof got})`,
  NUMBER_COMPARE: (name: string, expected: string, value: number) => `'${name}' must be ${expected} ${value}`,
  EMPTY_ARRAY: (name: string) => `'${name}' is an empty array`,
  EMPTY_FILTERED_ARRAY: (name: string, type: string) => `There is no valid '${type}' in the '${name}' array`,
  EMPTY_STRING: (name: string) => `'${name}' string must not be empty`,
  INVALID_KEY: (obj: string, key: string) => `'${key}' does not need to be provided in ${obj}`,
  MISSING_KEY: (obj: string, key: string) => `'${key}' needs to be provided in ${obj}`,
  MISSING_KEYS: (obj: string, key: string[], all: boolean) =>
    `${key.map(k => `'${k}'`).join(all ? " and " : " or ")} need to be provided in ${obj}`,

  MISSING_INTENTS: (i: string) => `${i} intent must be provided for the Client`,
  DISABLED_OPTION: (o: string) => `DisTubeOptions.${o} is disabled`,
  ENABLED_OPTION: (o: string) => `DisTubeOptions.${o} is enabled`,

  NOT_IN_VOICE: "User is not in any voice channel",
  VOICE_FULL: "The voice channel is full",
  VOICE_ALREADY_CREATED: "This guild already has a voice connection which is not managed by DisTube",
  VOICE_CONNECT_FAILED: (s: number) => `Cannot connect to the voice channel after ${s} seconds`,
  VOICE_MISSING_PERMS: "I do not have permission to join this voice channel",
  VOICE_RECONNECT_FAILED: "Cannot reconnect to the voice channel",
  VOICE_DIFFERENT_GUILD: "Cannot join a voice channel in a different guild",
  VOICE_DIFFERENT_CLIENT: "Cannot join a voice channel created by a different client",

  FFMPEG_EXITED: (code: number) => `ffmpeg exited with code ${code}`,
  FFMPEG_NOT_INSTALLED: (path: string) => `ffmpeg is not installed at '${path}' path`,

  NO_QUEUE: "There is no playing queue in this guild",
  QUEUE_EXIST: "This guild has a Queue already",
  QUEUE_STOPPED: "The queue has been stopped already",
  PAUSED: "The queue has been paused already",
  RESUMED: "The queue has been playing already",
  NO_PREVIOUS: "There is no previous song in this queue",
  NO_UP_NEXT: "There is no up next song",
  NO_SONG_POSITION: "Does not have any song at this position",
  NO_PLAYING_SONG: "There is no playing song in the queue",

  NO_RELATED: "Cannot find any related songs",
  CANNOT_PLAY_RELATED: "Cannot play the related song",
  UNAVAILABLE_VIDEO: "This video is unavailable",
  UNPLAYABLE_FORMATS: "No playable format found",
  NON_NSFW: "Cannot play age-restricted content in non-NSFW channel",
  NOT_SUPPORTED_URL: "This url is not supported",
  NOT_SUPPORTED_SONG: (song: string) => `There is no plugin supporting this song (${song})`,
  NO_VALID_SONG: "'songs' array does not have any valid Song or url",
  CANNOT_RESOLVE_SONG: (t: any) => `Cannot resolve ${inspect(t)} to a Song`,
  CANNOT_GET_STREAM_URL: (song: string) => `Cannot get stream url from this song (${song})`,
  CANNOT_GET_SEARCH_QUERY: (song: string) => `Cannot get search query from this song (${song})`,
  NO_RESULT: (query: string) => `Cannot get song stream from this query (${query})`,
  NO_STREAM_URL: (song: string) => `No stream url attached (${song})`,

  EMPTY_FILTERED_PLAYLIST:
    "There is no valid video in the playlist\n" +
    "Maybe age-restricted contents is filtered because you are in non-NSFW channel",
  EMPTY_PLAYLIST: "There is no valid video in the playlist",
};

type ErrorMessage = typeof ERROR_MESSAGES;
type ErrorCode = keyof ErrorMessage;
type StaticErrorCode = { [K in ErrorCode]-?: ErrorMessage[K] extends string ? K : never }[ErrorCode];
type TemplateErrorCode = Exclude<keyof typeof ERROR_MESSAGES, StaticErrorCode>;

const haveCode = (code: string): code is ErrorCode => Object.keys(ERROR_MESSAGES).includes(code);
const parseMessage = (m: string | ((...x: any) => string), ...args: any) => (typeof m === "string" ? m : m(...args));
const getErrorMessage = (code: string, ...args: any): string =>
  haveCode(code) ? parseMessage(ERROR_MESSAGES[code], ...args) : args[0];
export class DisTubeError<T extends string = any> extends Error {
  errorCode: string;
  constructor(code: T extends StaticErrorCode ? T : never);
  constructor(code: T extends TemplateErrorCode ? T : never, ...args: Parameters<ErrorMessage[typeof code]>);
  constructor(code: TemplateErrorCode, _: never);
  constructor(code: T extends ErrorCode ? never : T, message: string);
  constructor(code: string, ...args: any) {
    super(getErrorMessage(code, ...args));

    this.errorCode = code;
    if (Error.captureStackTrace) Error.captureStackTrace(this, DisTubeError);
  }

  override get name() {
    return `DisTubeError [${this.errorCode}]`;
  }

  get code() {
    return this.errorCode;
  }
}
