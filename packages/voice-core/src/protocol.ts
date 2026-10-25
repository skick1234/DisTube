export type Container = "webm" | "mp4";

export const WINDOW_BYTES = 256 * 1024;

export type InputSource =
  | Readonly<{ kind: "file"; path: string }>
  | Readonly<{ kind: "ranged"; size: number; container?: Container }>
  | Readonly<{ kind: "oneshot"; container?: Container }>;

export interface WireError {
  readonly name: string;
  readonly message: string;
  readonly code?: string | number;
  readonly cause?: WireError;
}

export type ToWorker =
  | Readonly<{
      type: "open";
      track: number;
      input: number;
      source: InputSource;
      volume: number;
      chain: string | undefined;
      bitrate: number;
      complexity: number;
    }>
  | Readonly<{ type: "seek"; track: number; request: number; input: number; source: InputSource; seconds: number }>
  | Readonly<{ type: "filters"; track: number; request: number; chain: string | undefined }>
  | Readonly<{ type: "probe"; track: number; chain: string }>
  | Readonly<{ type: "volume"; track: number; percent: number }>
  | Readonly<{ type: "bitrate"; track: number; bitrate: number }>
  | Readonly<{ type: "credit"; track: number; count: number }>
  | Readonly<{ type: "close"; track: number }>
  | Readonly<{
      type: "bytes";
      input: number;
      request: number;
      chunk?: ArrayBuffer;
      done?: boolean;
      failed?: boolean;
    }>
  | Readonly<{ type: "granted"; permit: number }>
  | Readonly<{ type: "exit" }>;

export type PermitMessage =
  | Readonly<{ type: "acquire"; permit: number }>
  | Readonly<{ type: "release"; permit: number }>;

export type FromWorker =
  | Readonly<{ type: "opened"; track: number }>
  | Readonly<{ type: "packets"; track: number; packets: ArrayBuffer[]; pts: number[] }>
  | Readonly<{
      type: "settled";
      track: number;
      request: number;
      position?: number;
      superseded?: boolean;
      input?: number;
      error?: WireError;
    }>
  | Readonly<{ type: "ended"; track: number }>
  | Readonly<{ type: "failed"; track: number; stage: string; input?: number; error: WireError }>
  | Readonly<{ type: "closed"; track: number }>
  | Readonly<{
      type: "read";
      track: number;
      input: number;
      request: number;
      start?: number;
      end?: number;
      want?: number;
    }>
  | Readonly<{ type: "cancel"; track: number; input: number; request: number }>
  | Readonly<{ type: "retired"; track: number; input: number }>;
