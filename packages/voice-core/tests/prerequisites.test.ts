import { describe, expect, it, vi } from "vitest";
import {
  createPrerequisiteCheck,
  DISCORD_ENCRYPTION_MODULES,
  DISCORD_OPUS_MODULES,
  ERIS_ENCRYPTION_MODULES,
  ERIS_OPUS_MODULES,
  type PrerequisiteModules,
  type PrerequisiteRuntime,
} from "../src/prerequisites";

function runtime(
  probeFfmpeg: PrerequisiteRuntime["probeFfmpeg"],
  loadModule: PrerequisiteRuntime["loadModule"],
): PrerequisiteRuntime {
  return { probeFfmpeg, loadModule };
}

function nativeOpus(dispose = vi.fn()): unknown {
  return {
    // oxlint-disable-next-line typescript/no-extraneous-class -- fake native constructor
    OpusEncoder: class {
      delete(): void {
        dispose();
      }
    },
  };
}

function scriptOpus(dispose = vi.fn()): unknown {
  return class {
    static Application = { AUDIO: 2049 };

    delete(): void {
      dispose();
    }
  };
}

async function rejected(completion: Promise<void>): Promise<Error> {
  return completion.then(
    () => {
      throw new Error("Expected prerequisite check to fail");
    },
    error => error as Error,
  );
}

describe("default voice engine prerequisites", () => {
  it("probes FFmpeg once with -version and loads Opus in native-first order", async () => {
    const probeFfmpeg = vi.fn(async (_command: string, _args: readonly string[]) => undefined);
    const loadModule = vi.fn((name: string) => {
      if (name === "@discordjs/opus") throw new Error("native encoder unavailable");
      return scriptOpus();
    });
    const check = createPrerequisiteCheck(
      { owner: "@distube/discordjs", encryption: DISCORD_ENCRYPTION_MODULES, opus: DISCORD_OPUS_MODULES },
      runtime(probeFfmpeg, loadModule),
    );

    const first = check();
    const second = check();

    expect(second).toBe(first);
    await first;
    expect(probeFfmpeg).toHaveBeenCalledTimes(1);
    expect(probeFfmpeg).toHaveBeenCalledWith(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]);
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["@discordjs/opus", "opusscript", "sodium-native"]);
  });

  it("rejects exports without a usable Opus constructor", async () => {
    const probeFfmpeg = vi.fn(async () => undefined);
    const loadModule = vi.fn((name: string) =>
      name === "@discordjs/opus" ? {} : name === "opusscript" ? { Application: { AUDIO: 2049 } } : {},
    );

    const failure = await rejected(
      createPrerequisiteCheck(
        { owner: "test-owner", encryption: [], opus: DISCORD_OPUS_MODULES },
        runtime(probeFfmpeg, loadModule),
      )(),
    );

    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    // The empty encryption list would reject too, so the message proves the Opus guard is the one that fired.
    expect(failure.message).toContain("test-owner requires an Opus implementation");
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(DISCORD_OPUS_MODULES);
  });

  it("constructs and disposes the native implementation before accepting it", async () => {
    const probeFfmpeg = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const loadModule = vi.fn((name: string) => (name === "@discordjs/opus" ? nativeOpus(dispose) : {}));

    await createPrerequisiteCheck(
      { owner: "test-owner", encryption: ["sodium-native"], opus: DISCORD_OPUS_MODULES },
      runtime(probeFfmpeg, loadModule),
    )();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(loadModule).toHaveBeenCalledTimes(2);
    expect(loadModule).toHaveBeenLastCalledWith("sodium-native");
  });

  it("tries the script encoder when the selected native binary cannot construct an encoder", async () => {
    const destroy = vi.fn();
    const loadModule = vi.fn((name: string) => {
      if (name === "@discordjs/opus") {
        return {
          // oxlint-disable-next-line typescript/no-extraneous-class -- fake native constructor
          OpusEncoder: class {
            constructor() {
              throw new Error("native binary cannot initialize");
            }
          },
        };
      }
      if (name === "opusscript") {
        return class {
          static Application = { AUDIO: 2049 };
          destroy(): void {
            destroy();
          }
        };
      }
      return {};
    });
    await expect(
      createPrerequisiteCheck(
        discordModules(),
        runtime(
          vi.fn(async () => undefined),
          loadModule,
        ),
      )(),
    ).resolves.toBeUndefined();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["@discordjs/opus", "opusscript", "sodium-native"]);
  });

  it("uses the constructor signatures required by the native and script encoder shapes", async () => {
    const nativeArguments = vi.fn();
    const scriptArguments = vi.fn();
    const native = {
      // oxlint-disable-next-line typescript/no-extraneous-class -- fake native constructor
      OpusEncoder: class {
        constructor(rate: number, channels: number) {
          nativeArguments(rate, channels);
        }
      },
    };
    const script = class {
      static Application = { AUDIO: 2049 };
      constructor(rate: number, channels: number, application: number) {
        scriptArguments(rate, channels, application);
      }
    };
    for (const [selected, module] of [
      ["@discordjs/opus", native],
      ["opusscript", script],
    ] as const) {
      await createPrerequisiteCheck(
        { owner: "test-owner", opus: [selected], encryption: ["sodium-native"] },
        runtime(
          vi.fn(async () => undefined),
          name => (name === selected ? module : {}),
        ),
      )();
    }

    expect(nativeArguments).toHaveBeenCalledWith(48_000, 2);
    expect(scriptArguments).toHaveBeenCalledWith(48_000, 2, 2049);
  });

  it("loads @noble/ciphers by the submodule specifier the voice library itself uses", async () => {
    const probeFfmpeg = vi.fn(async () => undefined);
    // The root module throws by design, so probing the bare package name would reject a working install.
    const loadModule = vi.fn((name: string) => {
      if (name === "@noble/ciphers") throw new Error("root module cannot be imported");
      return name === "@discordjs/opus" ? nativeOpus(vi.fn()) : { xchacha20poly1305: vi.fn() };
    });

    await createPrerequisiteCheck(
      { owner: "@distube/discordjs", encryption: ["@noble/ciphers"], opus: DISCORD_OPUS_MODULES },
      runtime(probeFfmpeg, loadModule),
    )();

    expect(loadModule).toHaveBeenLastCalledWith("@noble/ciphers/chacha.js");
  });

  it("returns safe FFmpeg guidance when the probe fails", async () => {
    const signed = "https://stream.example/audio?token=top-secret";
    const probeFfmpeg = vi.fn(async () => {
      throw new Error(`missing decoder for ${signed}`);
    });
    const loadModule = vi.fn(() => ({}));
    const failure = await rejected(createPrerequisiteCheck(discordModules(), runtime(probeFfmpeg, loadModule))());

    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.message).toContain("requires FFmpeg");
    expect(failure.message).not.toContain(signed);
    expect(failure.message).not.toContain("top-secret");
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("returns safe Opus guidance when every supported implementation is unavailable", async () => {
    const probeFfmpeg = vi.fn(async () => undefined);
    const loadModule = vi.fn((name: string) => {
      throw new Error(`cannot load ${name} with token=top-secret`);
    });
    const failure = await rejected(createPrerequisiteCheck(discordModules(), runtime(probeFfmpeg, loadModule))());

    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.message).toContain("Opus implementation");
    // The message names the owning package and its own configured list, not a hardcoded pair.
    expect(failure.message).toContain("@distube/discordjs requires an Opus implementation");
    expect(failure.message).toContain(DISCORD_OPUS_MODULES.join(", "));
    expect(failure.message).not.toContain("top-secret");
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(DISCORD_OPUS_MODULES);
  });
});

describe("voice encryption prerequisite", () => {
  it("accepts sodium when it is the only Discord voice encryption provider", async () => {
    const loadModule = vi.fn((name: string) => {
      if (name === "@discordjs/opus") return nativeOpus();
      if (name === "sodium-native") throw new Error("native library unavailable");
      if (name === "sodium") return {};
      throw new Error(`unexpected module ${name}`);
    });
    const check = createPrerequisiteCheck(
      discordModules(),
      runtime(
        vi.fn(async () => undefined),
        loadModule,
      ),
    );

    await expect(check()).resolves.toBeUndefined();
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["@discordjs/opus", "sodium-native", "sodium"]);
  });

  it("accepts Eris's tweetnacl fallback after sodium-native is missing", async () => {
    const loadModule = vi.fn((name: string) => {
      if (name === "@discordjs/opus") throw new Error("native encoder unavailable");
      if (name === "opusscript") return scriptOpus();
      if (name === "sodium-native") throw new Error("native library unavailable");
      return {};
    });
    const check = createPrerequisiteCheck(
      erisModules(),
      runtime(
        vi.fn(async () => undefined),
        loadModule,
      ),
    );

    await expect(check()).resolves.toBeUndefined();
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual([...ERIS_OPUS_MODULES, ...ERIS_ENCRYPTION_MODULES]);
  });

  it("keeps trying supported encryption modules when one loads without a usable export", async () => {
    const loadModule = vi.fn((name: string) => {
      if (name === "@discordjs/opus") return nativeOpus();
      if (name === "sodium-native") return null;
      if (name === "sodium") return { ready: true };
      throw new Error(`unexpected module ${name}`);
    });

    await expect(
      createPrerequisiteCheck(
        discordModules(),
        runtime(
          vi.fn(async () => undefined),
          loadModule,
        ),
      )(),
    ).resolves.toBeUndefined();
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["@discordjs/opus", "sodium-native", "sodium"]);
  });

  it("fails with VOICE_FAILED naming the adapter package and one accepted implementation", async () => {
    const loadModule = vi.fn((name: string) => {
      if (name === "@discordjs/opus") return nativeOpus();
      throw new Error(`cannot load ${name}`);
    });
    const failure = await rejected(
      createPrerequisiteCheck(
        erisModules(),
        runtime(
          vi.fn(async () => undefined),
          loadModule,
        ),
      )(),
    );

    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.message).toContain("@distube/eris");
    expect(failure.message).toContain("tweetnacl");
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["@discordjs/opus", "sodium-native", "tweetnacl"]);
  });

  it("retries a selected local Opus implementation after concurrent callers share its failure", async () => {
    let scriptReady = false;
    const probeFfmpeg = vi.fn(async () => undefined);
    const loadModule = vi.fn((name: string) => {
      if (name === "@discordjs/opus") throw new Error("native binary unavailable");
      if (name === "opusscript" && !scriptReady) throw new Error("script package not installed yet");
      return name === "opusscript" ? scriptOpus() : {};
    });
    const check = createPrerequisiteCheck(discordModules(), runtime(probeFfmpeg, loadModule));

    const first = check();
    const concurrent = check();
    expect(concurrent).toBe(first);
    const [firstFailure, concurrentFailure] = await Promise.all([rejected(first), rejected(concurrent)]);
    expect(concurrentFailure).toBe(firstFailure);
    expect(firstFailure).toMatchObject({ code: "VOICE_FAILED" });

    scriptReady = true;
    await expect(check()).resolves.toBeUndefined();
    await expect(check()).resolves.toBeUndefined();
    expect(probeFfmpeg).toHaveBeenCalledTimes(2);
    expect(loadModule.mock.calls.filter(([name]) => name === "opusscript")).toHaveLength(2);
  });
});

function discordModules(): PrerequisiteModules {
  return { owner: "@distube/discordjs", encryption: DISCORD_ENCRYPTION_MODULES, opus: DISCORD_OPUS_MODULES };
}

function erisModules(): PrerequisiteModules {
  return { owner: "@distube/eris", encryption: ERIS_ENCRYPTION_MODULES, opus: ERIS_OPUS_MODULES };
}
