import { describe, expect, it, vi } from "vitest";
import {
  createPrerequisiteCheck,
  DISCORD_ENCRYPTION_MODULES,
  ERIS_ENCRYPTION_MODULES,
  type PrerequisiteModules,
  type PrerequisiteRuntime,
} from "../src/prerequisites";

function runtime(
  loadModule: PrerequisiteRuntime["loadModule"],
  loadDecoder: PrerequisiteRuntime["loadDecoder"] = async () => ({}),
): PrerequisiteRuntime {
  return { loadDecoder, loadModule };
}

async function rejected(completion: Promise<void>): Promise<Error> {
  return completion.then(
    () => {
      throw new Error("Expected prerequisite check to fail");
    },
    error => error as Error,
  );
}

function discordModules(): PrerequisiteModules {
  return { owner: "@distube/discordjs", encryption: DISCORD_ENCRYPTION_MODULES };
}

function erisModules(): PrerequisiteModules {
  return { owner: "@distube/eris", encryption: ERIS_ENCRYPTION_MODULES };
}

describe("default voice engine prerequisites", () => {
  it("loads the decoder binding once for concurrent callers, then probes encryption in order", async () => {
    const loadDecoder = vi.fn(async () => ({}));
    const loadModule = vi.fn((name: string) => {
      if (name === "sodium-native") throw new Error("native library unavailable");
      return {};
    });
    const check = createPrerequisiteCheck(discordModules(), runtime(loadModule, loadDecoder));

    const first = check();
    const second = check();

    expect(second).toBe(first);
    await first;
    await check();
    expect(loadDecoder).toHaveBeenCalledTimes(1);
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["sodium-native", "sodium"]);
  });

  it("names node-av and the glibc requirement when the binding cannot load", async () => {
    const loadModule = vi.fn(() => ({}));
    const failure = await rejected(
      createPrerequisiteCheck(
        discordModules(),
        runtime(loadModule, async () => {
          throw new Error("Error loading shared library ld-linux-x86-64.so.2 at /private/node-av.node");
        }),
      )(),
    );

    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.message).toContain("@distube/discordjs requires the node-av native binding");
    expect(failure.message).toContain("glibc 2.28");
    expect(failure.message).not.toContain("/private/node-av.node");
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("probes the binding again after a failure that concurrent callers shared", async () => {
    let installed = false;
    const loadDecoder = vi.fn(async () => {
      if (!installed) throw new Error("binding missing");
      return {};
    });
    const check = createPrerequisiteCheck(
      discordModules(),
      runtime(() => ({}), loadDecoder),
    );

    const first = check();
    const concurrent = check();
    expect(concurrent).toBe(first);
    const [firstFailure, concurrentFailure] = await Promise.all([rejected(first), rejected(concurrent)]);
    expect(concurrentFailure).toBe(firstFailure);

    installed = true;
    await expect(check()).resolves.toBeUndefined();
    await expect(check()).resolves.toBeUndefined();
    expect(loadDecoder).toHaveBeenCalledTimes(2);
  });

  it("loads @noble/ciphers by the submodule specifier the voice library itself uses", async () => {
    // The root module throws by design, so probing the bare package name would reject a working install.
    const loadModule = vi.fn((name: string) => {
      if (name === "@noble/ciphers") throw new Error("root module cannot be imported");
      return { xchacha20poly1305: vi.fn() };
    });

    await createPrerequisiteCheck(
      { owner: "@distube/discordjs", encryption: ["@noble/ciphers"] },
      runtime(loadModule),
    )();

    expect(loadModule).toHaveBeenLastCalledWith("@noble/ciphers/chacha.js");
  });
});

describe("voice encryption prerequisite", () => {
  it("accepts sodium when it is the only Discord voice encryption provider", async () => {
    const loadModule = vi.fn((name: string) => {
      if (name === "sodium-native") throw new Error("native library unavailable");
      if (name === "sodium") return {};
      throw new Error(`unexpected module ${name}`);
    });

    await expect(createPrerequisiteCheck(discordModules(), runtime(loadModule))()).resolves.toBeUndefined();
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["sodium-native", "sodium"]);
  });

  it("accepts Eris's tweetnacl fallback after sodium-native is missing", async () => {
    const loadModule = vi.fn((name: string) => {
      if (name === "sodium-native") throw new Error("native library unavailable");
      return {};
    });

    await expect(createPrerequisiteCheck(erisModules(), runtime(loadModule))()).resolves.toBeUndefined();
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual([...ERIS_ENCRYPTION_MODULES]);
  });

  it("keeps trying supported encryption modules when one loads without a usable export", async () => {
    const loadModule = vi.fn((name: string) => {
      if (name === "sodium-native") return null;
      if (name === "sodium") return { ready: true };
      throw new Error(`unexpected module ${name}`);
    });

    await expect(createPrerequisiteCheck(discordModules(), runtime(loadModule))()).resolves.toBeUndefined();
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["sodium-native", "sodium"]);
  });

  it("fails with VOICE_FAILED naming the adapter package and one accepted implementation", async () => {
    const loadModule = vi.fn((name: string) => {
      throw new Error(`cannot load ${name} with token=top-secret`);
    });

    const failure = await rejected(createPrerequisiteCheck(erisModules(), runtime(loadModule))());

    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.message).toContain("@distube/eris requires a voice encryption implementation");
    expect(failure.message).toContain("tweetnacl");
    expect(failure.message).not.toContain("top-secret");
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["sodium-native", "tweetnacl"]);
  });
});
