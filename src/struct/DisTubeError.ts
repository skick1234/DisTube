const ERROR_MESSAGES = {
  INVALID_TYPE: (expected: string | string[], got: any, name?: string) =>
    `Expected ${
      Array.isArray(expected) ? expected.map(e => (typeof e === "number" ? e : `'${e}'`)).join(" or ") : `'${expected}'`
    }${name ? ` for '${name}'` : ""}, but got ${
      typeof got === "string"
        ? `'${got}'`
        : typeof got === "number"
        ? got
        : Array.isArray(got)
        ? `Array<${got.length}>`
        : got?.constructor?.name || typeof got
    }`,
  NUMBER_COMPARE: (name: string, expected: string, value: number) => `'${name}' must be ${expected} ${value}`,
  EMPTY_ARRAY: (name: string) => `'${name}' is an empty array`,
  EMPTY_FILTERED_ARRAY: (name: string, type: string) => `There is no valid '${type}' in the '${name}' array`,

  MISSING_INTENTS: (i: string) => `${i} intent must be provided for the Client`,
  DISABLED_OPTION: (o: string) => `DisTubeOptions.${o} is disabled`,
  ENABLED_OPTION: (o: string) => `DisTubeOptions.${o} is enabled`,

  NOT_IN_VOICE: "User is not in any voice channel",
  NOT_SUPPORTED_VOICE: "DisTubeVoice only supports VoiceChannel or a StageChannel",
  VOICE_FULL: "The voice channel is full",
  VOICE_CONNECT_FAILED: (s: number) => `Cannot connect to the voice channel after ${s} seconds`,
  VOICE_MISSING_PERMS: "You do not have permission to join this voice channel",
  VOICE_RECONNECT_FAILED: "Cannot reconnect to the voice channel",
  VOICE_CHANGE_GUILD: "Cannot join a channel in a different guild",

  NO_QUEUE: "There is no playing queue in this guild",
  QUEUE_EXIST: "This guild has a Queue already",
  ADD_BEFORE_PLAYING: "Cannot add Song before the playing Song",
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
  CANNOT_RESOLVE_SONG: (t: string) => `Cannot resolve ${t} to a Song`,
  NO_VALID_SONG: "'songs' array does not have any valid Song, SearchResult or url",
  EMPTY_FILTERED_PLAYLIST:
    "There is no valid video in the playlist\nMaybe age-restricted contents is filtered because you are in non-NSFW channel",
  EMPTY_PLAYLIST: "There is no valid video in the playlist",
};

const createMessage = (msg: string | ((...x: any) => string), ...args: any) => {
  if (typeof msg === "string") return msg;
  return msg(...args);
};

export class DisTubeError extends Error {
  errorCode: string;
  constructor(code: keyof typeof ERROR_MESSAGES, ...args: any) {
    if (!Object.keys(ERROR_MESSAGES).includes(code)) throw new TypeError(`Error code '${code}' does not exist`);

    super(createMessage(ERROR_MESSAGES[code], ...args));
    this.errorCode = code;
    if (Error.captureStackTrace) Error.captureStackTrace(this, DisTubeError);
  }

  get name() {
    return `${super.name} [${this.errorCode}]`;
  }

  get code() {
    return this.errorCode;
  }
}

export default DisTubeError;
