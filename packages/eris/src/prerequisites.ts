import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { DisTubeError, ErrorCode } from "distube";
import { ffmpegCommand } from "./ffmpeg";

const require = createRequire(import.meta.url);

/** Eris selects its native encoder before falling back to the JavaScript implementation. */
export const ERIS_OPUS_MODULES = ["@discordjs/opus", "opusscript"] as const;

/** Private runtime seam for deterministic prerequisite coverage. */
export interface PrerequisiteRuntime {
  probeFfmpeg(command: string, args: readonly string[]): Promise<void>;
  loadModule(name: string): unknown;
}

/** Returns one lazily started, shared prerequisite check for one Eris default engine instance. */
export function createPrerequisiteCheck(
  opusModules: readonly string[] = ERIS_OPUS_MODULES,
  runtime: PrerequisiteRuntime = systemRuntime,
): () => Promise<void> {
  let completion: Promise<void> | undefined;
  return () => (completion ??= verifyPrerequisites(opusModules, runtime));
}

async function verifyPrerequisites(opusModules: readonly string[], runtime: PrerequisiteRuntime): Promise<void> {
  try {
    await runtime.probeFfmpeg(ffmpegCommand(), ["-version"]);
  } catch {
    throw new DisTubeError(
      ErrorCode.VOICE_FAILED,
      "The default Eris voice engine requires FFmpeg. Install FFmpeg, expose it as ffmpeg, or set FFMPEG_PATH.",
    );
  }

  for (const module of opusModules) {
    try {
      validateOpusModule(module, runtime.loadModule(module));
      return;
    } catch {
      // Eris itself tries the JavaScript fallback after the native encoder is unavailable.
    }
  }
  throw new DisTubeError(
    ErrorCode.VOICE_FAILED,
    "The default Eris voice engine requires an Opus implementation. Install @discordjs/opus or opusscript.",
  );
}

/** Checks the constructor Eris invokes for PCM playback, then disposes the short-lived probe. */
function validateOpusModule(name: string, loaded: unknown): void {
  if (name === "@discordjs/opus") {
    const encoder = construct(readMember(loaded, "OpusEncoder"), [48_000, 2]);
    disposeEncoder(encoder);
    return;
  }
  if (name === "opusscript") {
    const application = readMember(loaded, "Application");
    const audio = readMember(application, "AUDIO");
    if (typeof audio !== "number") throw new TypeError("opusscript does not expose Application.AUDIO");
    const encoder = construct(loaded, [48_000, 2, audio]);
    disposeEncoder(encoder);
    return;
  }
  throw new TypeError(`Unsupported Opus implementation "${name}"`);
}

function readMember(value: unknown, member: PropertyKey): unknown {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return undefined;
  return Reflect.get(value, member);
}

function construct(value: unknown, arguments_: readonly unknown[]): unknown {
  if (typeof value !== "function") throw new TypeError("Opus implementation does not expose a constructor");
  return Reflect.construct(value, arguments_);
}

function disposeEncoder(encoder: unknown): void {
  const dispose = readMember(encoder, "delete") ?? readMember(encoder, "destroy");
  if (dispose !== undefined) {
    if (typeof dispose !== "function") throw new TypeError("Opus encoder disposal is not callable");
    Reflect.apply(dispose, encoder, []);
  }
}

const systemRuntime: PrerequisiteRuntime = {
  probeFfmpeg(command, args): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, args, { stdio: "ignore", windowsHide: true });
      } catch (error: unknown) {
        reject(error);
        return;
      }
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0 && signal === null) resolve();
        else reject(new Error(`FFmpeg probe exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`));
      });
    });
  },
  loadModule(name): unknown {
    return require(name);
  },
};
