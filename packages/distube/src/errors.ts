export enum ErrorCode {
  INVALID_ARGUMENT = "INVALID_ARGUMENT",
  SOURCE_FAILED = "SOURCE_FAILED",
  VOICE_FAILED = "VOICE_FAILED",
  PLUGIN_FAILED = "PLUGIN_FAILED",
  QUEUE_FAILED = "QUEUE_FAILED",
}

export class DisTubeError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DisTubeError";
    this.code = code;
  }
}

export function asDisTubeError(code: ErrorCode, message: string, error: unknown): DisTubeError {
  if (error instanceof DisTubeError && error.code === code) return error;
  const cause = error instanceof Error ? error : new Error(String(error));
  return new DisTubeError(code, message, { cause });
}
