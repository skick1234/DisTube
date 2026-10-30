import { DisTubeError, ErrorCode, type ErrorCode as ErrorCodeType } from "../src";

declare const error: unknown;

if (DisTubeError.is(error, ErrorCode.ABORTED)) {
  const aborted: "ABORTED" = error.code;
  void aborted;
  // @ts-expect-error the narrowed code is exactly ABORTED
  const other: "INVALID_STATE" = error.code;
  void other;
}

if (DisTubeError.is(error)) {
  const code: ErrorCodeType = error.code;
  const source: string | undefined = error.source;
  void [code, source];
}

const rateLimited = new DisTubeError(ErrorCode.RATE_LIMITED, "slow down", { source: "spotify" });
const rateLimitedCode: "RATE_LIMITED" = rateLimited.code;

declare const failure: DisTubeError;
function describe(caught: DisTubeError): string {
  switch (caught.code) {
    case ErrorCode.INVALID_ARGUMENT:
    case ErrorCode.INVALID_STATE:
    case ErrorCode.ABORTED:
    case ErrorCode.UNSUPPORTED:
    case ErrorCode.AGE_RESTRICTED:
      return "caller";
    case ErrorCode.NO_RESULT:
    case ErrorCode.NOT_FOUND:
    case ErrorCode.UNAVAILABLE:
    case ErrorCode.RATE_LIMITED:
    case ErrorCode.BOT_CHECK:
    case ErrorCode.NOT_STARTED:
    case ErrorCode.SOURCE_FAILED:
      return `provider ${caught.source ?? "core"}`;
    case ErrorCode.VOICE_FAILED:
    case ErrorCode.VOICE_DISCONNECTED:
      return "voice";
    default: {
      const exhaustive: never = caught.code;
      return exhaustive;
    }
  }
}

const spelled: { readonly [K in keyof typeof ErrorCode]: K } = ErrorCode;

// @ts-expect-error codes are the core set; plugins no longer add their own
const plugin: ErrorCodeType = "YOUTUBE_AGE_RESTRICTED";
// @ts-expect-error the constructor takes a core code
new DisTubeError("SPOTIFY_NOT_FOUND", "message");

const widened: DisTubeError = rateLimited;

void [rateLimitedCode, describe(failure), spelled, plugin, widened];
