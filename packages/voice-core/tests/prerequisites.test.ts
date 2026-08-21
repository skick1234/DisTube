import { ErrorCode } from "distube";
import { describe, expect, it, vi } from "vitest";
import { createPrerequisiteCheck, DISCORD_OPUS_MODULES, type PrerequisiteRuntime } from "../src/prerequisites";

function runtime(
  probeFfmpeg: PrerequisiteRuntime["probeFfmpeg"],
  loadModule: PrerequisiteRuntime["loadModule"],
): PrerequisiteRuntime {
  return { probeFfmpeg, loadModule };
}

function nativeOpus(dispose = vi.fn()): unknown {
  return {
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
    const check = createPrerequisiteCheck(DISCORD_OPUS_MODULES, runtime(probeFfmpeg, loadModule));

    const first = check();
    const second = check();

    expect(second).toBe(first);
    await first;
    expect(probeFfmpeg).toHaveBeenCalledTimes(1);
    expect(probeFfmpeg).toHaveBeenCalledWith(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]);
    expect(loadModule).toHaveBeenNthCalledWith(1, "@discordjs/opus");
    expect(loadModule).toHaveBeenNthCalledWith(2, "opusscript");
  });

  it("rejects exports without a usable Opus constructor", async () => {
    const probeFfmpeg = vi.fn(async () => undefined);
    const loadModule = vi.fn((name: string) => (name === "@discordjs/opus" ? {} : { Application: { AUDIO: 2049 } }));

    const failure = await rejected(createPrerequisiteCheck(DISCORD_OPUS_MODULES, runtime(probeFfmpeg, loadModule))());

    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED });
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(DISCORD_OPUS_MODULES);
  });

  it("constructs and disposes the native implementation before accepting it", async () => {
    const probeFfmpeg = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const loadModule = vi.fn(() => nativeOpus(dispose));

    await createPrerequisiteCheck(DISCORD_OPUS_MODULES, runtime(probeFfmpeg, loadModule))();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(loadModule).toHaveBeenCalledTimes(1);
  });

  it("returns safe FFmpeg guidance when the probe fails", async () => {
    const signed = "https://stream.example/audio?token=top-secret";
    const probeFfmpeg = vi.fn(async () => {
      throw new Error(`missing decoder for ${signed}`);
    });
    const loadModule = vi.fn(() => ({}));
    const failure = await rejected(createPrerequisiteCheck(DISCORD_OPUS_MODULES, runtime(probeFfmpeg, loadModule))());

    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED });
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
    const failure = await rejected(createPrerequisiteCheck(DISCORD_OPUS_MODULES, runtime(probeFfmpeg, loadModule))());

    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED });
    expect(failure.message).toContain("Opus implementation");
    expect(failure.message).toContain("@discordjs/opus or opusscript");
    expect(failure.message).not.toContain("top-secret");
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(DISCORD_OPUS_MODULES);
  });
});
