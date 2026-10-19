import { DisTubeError, ErrorCode, type ErrorCode as ErrorCodeType } from "../src";

declare const error: unknown;

// The static guard narrows to the exact literal it was given.
if (DisTubeError.is(error, ErrorCode.ABORTED)) {
  const aborted: "ABORTED" = error.code;
  void aborted;
  // @ts-expect-error the narrowed code is exactly ABORTED
  const other: "INVALID_STATE" = error.code;
  void other;
}

// Plugin packages export their own const objects and narrow the same way.
const SpotifyErrorCode = { NOT_FOUND: "SPOTIFY_NOT_FOUND", RATE_LIMITED: "SPOTIFY_RATE_LIMITED" } as const;
if (DisTubeError.is(error, SpotifyErrorCode.NOT_FOUND)) {
  const notFound: "SPOTIFY_NOT_FOUND" = error.code;
  void notFound;
  const owned: DisTubeError<"SPOTIFY_NOT_FOUND"> = error;
  void owned;
}
const spotify = new DisTubeError(SpotifyErrorCode.RATE_LIMITED, "slow down");
const spotifyCode: "SPOTIFY_RATE_LIMITED" = spotify.code;

// A plain DisTubeError carries a string code, so a switch with a default is exhaustive for unknown plugin codes.
declare const failure: DisTubeError;
function describe(caught: DisTubeError): string {
  switch (caught.code) {
    case ErrorCode.NO_RESULT:
      return "nothing found";
    case SpotifyErrorCode.NOT_FOUND:
      return "not on Spotify";
    default:
      return caught.code;
  }
}

// Every exported core code is spelled exactly like its key.
const spelled: { readonly [K in keyof typeof ErrorCode]: K } = ErrorCode;

// The exported type accepts the core literals and any plugin string, while completion keeps the literals.
const core: ErrorCodeType = "INVALID_ARGUMENT";
const plugin: ErrorCodeType = "YOUTUBE_AGE_RESTRICTED";
// @ts-expect-error codes are strings
const numeric: ErrorCodeType = 1;
// @ts-expect-error the constructor takes a string code; a non-string needs `never`
new DisTubeError(123, "message");
const forced = new DisTubeError(123 as never, "message");

// Widening keeps assignment covariant: a narrowed error is still a DisTubeError.
const widened: DisTubeError = spotify;
const generic: DisTubeError<string> = new DisTubeError(ErrorCode.QUEUE_FAILED, "queue");

void [spelled, spotifyCode, describe(failure), core, plugin, numeric, forced, widened, generic];
