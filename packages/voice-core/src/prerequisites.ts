import { createRequire } from "node:module";
import { DisTubeError } from "distube";

const require = createRequire(import.meta.url);

/** Encryption implementations @discordjs/voice probes, in its own preference order. */
export const DISCORD_ENCRYPTION_MODULES = [
  "sodium-native",
  "sodium",
  "libsodium-wrappers",
  "@stablelib/xchacha20poly1305",
  "@noble/ciphers",
] as const;

/** Eris loads these inside its VoiceConnection constructor, in this order, once per process. */
export const ERIS_ENCRYPTION_MODULES = ["sodium-native", "tweetnacl"] as const;

/** What one official default engine requires, and the package that names itself in public errors. */
export interface PrerequisiteModules {
  readonly owner: string;
  readonly encryption: readonly string[];
}

/** Private runtime seam for deterministic prerequisite coverage. */
export interface PrerequisiteRuntime {
  loadDecoder(): Promise<unknown>;
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
    await runtime.loadDecoder();
  } catch {
    throw new DisTubeError(
      "VOICE_FAILED",
      `${modules.owner} requires the node-av native binding, which runs on glibc 2.28 or newer (musl hosts such as Alpine are unsupported). Reinstall node-av on a supported host.`,
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
    "VOICE_FAILED",
    `${modules.owner} requires a voice encryption implementation. Install one of: ${modules.encryption.join(", ")}.`,
  );
}

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

const systemRuntime: PrerequisiteRuntime = {
  loadDecoder: () => import("node-av"),
  loadModule(name): unknown {
    return require(name);
  },
};
