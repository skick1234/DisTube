import { inspect } from "node:util";

const ERROR_MESSAGES = {
  INVALID_TYPE: (expected: (number | string) | readonly (number | string)[], got: any, name?: string) =>
    `Expected ${
      Array.isArray(expected) ? expected.map(e => (typeof e === "number" ? e : `'${e}'`)).join(" or ") : `'${expected}'`
    }${name ? ` for '${name}'` : ""}, but got ${inspect(got)}`,
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
  VOICE_CONNECT_FAILED: (s: number) => `Cannot connect to the voice channel after ${s} seconds`,
  VOICE_MISSING_PERMS: "You do not have permission to join this voice channel",
  VOICE_RECONNECT_FAILED: "Cannot reconnect to the voice channel",
  VOICE_CHANGE_GUILD: "Cannot join a channel in a different guild",

  NO_QUEUE: "There is no playing queue in this guild",
  QUEUE_EXIST: "This guild has a Queue already",
  PAUSED: "The queue has been paused already",
  RESUMED: "The queue has been playing already",
  NO_PREVIOUS: "There is no previous song in this queue",
  NO_UP_NEXT: "There is no up next song",
  NO_SONG_POSITION: "Does not have any song at this position",
  NO_PLAYING: "There is no playing song in the queue",

  NO_RESULT: "No result found",
  NO_RELATED: "Cannot find any related songs",
  CANNOT_PLAY_RELATED: "Cannot play the related song",
  UNAVAILABLE_VIDEO: "This video is unavailable",
  UNPLAYABLE_FORMATS: "No playable format found",
  NON_NSFW: "Cannot play age-restricted content in non-NSFW channel",
  NOT_SUPPORTED_URL: "This url is not supported",
  CANNOT_RESOLVE_SONG: (t: any) => `Cannot resolve ${inspect(t)} to a Song`,
  NO_VALID_SONG: "'songs' array does not have any valid Song, SearchResult or url",
  EMPTY_FILTERED_PLAYLIST:
    "There is no valid video in the playlist\n" +
    "Maybe age-restricted contents is filtered because you are in non-NSFW channel",
  EMPTY_PLAYLIST: "There is no valid video in the playlist",
};

type ErrorMessages = typeof ERROR_MESSAGES;
type ErrorCodes = keyof ErrorMessages;
type ErrorCode = { [K in ErrorCodes]-?: ErrorMessages[K] extends string ? K : never }[ErrorCodes];
type ErrorCodeTemplate = Exclude<keyof typeof ERROR_MESSAGES, ErrorCode>;

const errMsg = (msg: string | ((...x: any) => string), ...args: any) => (typeof msg === "string" ? msg : msg(...args));

const haveCode = (code: string): code is ErrorCodes => Object.keys(ERROR_MESSAGES).includes(code);

export class DisTubeError<T extends string> extends Error {
  errorCode: string;
  constructor(code: ErrorCode);
  constructor(code: T extends ErrorCodeTemplate ? T : never, ...args: Parameters<ErrorMessages[typeof code]>);
  constructor(code: ErrorCodeTemplate, _: never);
  constructor(code: T extends ErrorCodes ? "This is built-in error code" : T, message: string);
  constructor(code: string, ...args: any) {
    if (haveCode(code)) super(errMsg(ERROR_MESSAGES[code], ...args));
    else super(...args);

    this.errorCode = code;
    if (Error.captureStackTrace) Error.captureStackTrace(this, DisTubeError);
  }

  get name() {
    return `DisTubeError [${this.errorCode}]`;
  }

  get code() {
    return this.errorCode;
  }
}
