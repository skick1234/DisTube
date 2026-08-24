import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { DisTubeError, ErrorCode } from "distube";
import { ffmpegCommand } from "./ffmpeg";

const require = createRequire(import.meta.url);

/** Opus implementations supported by @discordjs/voice, in its native-first preference order. */
export const DISCORD_OPUS_MODULES = ["@discordjs/opus", "opusscript"] as const;

/** Encryption implementations @discordjs/voice probes, in its own preference order. */
export const DISCORD_ENCRYPTION_MODULES = [
  "sodium-native",
  "libsodium-wrappers",
  "@stablelib/xchacha20poly1305",
  "@noble/ciphers",
] as const;

/** Eris selects its native encoder before the JavaScript one, and sodium-native before tweetnacl. */
export const ERIS_OPUS_MODULES = ["@discordjs/opus", "opusscript"] as const;

/** Eris loads these inside its VoiceConnection constructor, in this order, once per process. */
export const ERIS_ENCRYPTION_MODULES = ["sodium-native", "tweetnacl"] as const;

/** What one official default engine requires, and the package that names itself in public errors. */
export interface PrerequisiteModules {
  readonly owner: string;
  readonly encryption: readonly string[];
  readonly opus: readonly string[];
}

/** Private runtime seam for deterministic prerequisite coverage. */
export interface PrerequisiteRuntime {
  probeFfmpeg(command: string, args: readonly string[]): Promise<void>;
  loadModule(name: string): unknown;
}

/** Returns one lazily started, shared prerequisite check for one default engine instance. */
export function createPrerequisiteCheck(
  modules: PrerequisiteModules,
  runtime: PrerequisiteRuntime = systemRuntime,
): () => Promise<void> {
  let completion: Promise<void> | undefined;
  return () => {
    completion ??= verifyPrerequisites(modules, runtime);
    const attempt = completion;
    // A rejected probe is discarded once settled so the next attempt probes again; only success
    // is reused for the process lifetime. Concurrent callers still share one attempt.
    void attempt.catch(() => {
      if (completion === attempt) completion = undefined;
    });
    return attempt;
  };
}

async function verifyPrerequisites(modules: PrerequisiteModules, runtime: PrerequisiteRuntime): Promise<void> {
  try {
    await runtime.probeFfmpeg(ffmpegCommand(), ["-version"]);
  } catch {
    throw new DisTubeError(
      ErrorCode.VOICE_FAILED,
      `${modules.owner} requires FFmpeg. Install FFmpeg, expose it as ffmpeg, or set FFMPEG_PATH.`,
    );
  }

  let opus = false;
  for (const module of modules.opus) {
    try {
      validateOpusModule(module, runtime.loadModule(module));
      opus = true;
      break;
    } catch {
      // Try the next supported implementation. Its loader or constructor can reject an unavailable native binary.
    }
  }
  if (!opus) {
    throw new DisTubeError(
      ErrorCode.VOICE_FAILED,
      `${modules.owner} requires an Opus implementation. Install one of: ${modules.opus.join(", ")}.`,
    );
  }

  for (const module of modules.encryption) {
    try {
      validateEncryptionModule(module, runtime.loadModule(ENCRYPTION_SPECIFIERS[module] ?? module));
      return;
    } catch {
      // The voice libraries themselves try each accepted implementation before giving up on voice.
    }
  }
  throw new DisTubeError(
    ErrorCode.VOICE_FAILED,
    `${modules.owner} requires a voice encryption implementation. Install one of: ${modules.encryption.join(", ")}.`,
  );
}

/** Checks the constructor the supported voice engines need, then disposes the short-lived probe. */
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

/** Loading the module is the probe: the voice libraries accept whichever import succeeds. */
/**
 * The specifier each accepted implementation is loaded by, where it differs from its package name.
 *
 * `@noble/ciphers` throws on a root import and requires a submodule, which is the specifier
 * `@discordjs/voice` itself uses. Probing the package name would reject an install that works.
 */
const ENCRYPTION_SPECIFIERS: Readonly<Record<string, string>> = {
  "@noble/ciphers": "@noble/ciphers/chacha.js",
};

function validateEncryptionModule(name: string, loaded: unknown): void {
  if (!loaded) throw new TypeError(`Encryption implementation "${name}" exposed no usable module`);
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
