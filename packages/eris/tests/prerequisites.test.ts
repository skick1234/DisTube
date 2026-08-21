import { ErrorCode } from "distube";
import { describe, expect, it, vi } from "vitest";
import { createPrerequisiteCheck, ERIS_OPUS_MODULES, type PrerequisiteRuntime } from "../src/prerequisites";

function runtime(
  probeFfmpeg: PrerequisiteRuntime["probeFfmpeg"],
  loadModule: PrerequisiteRuntime["loadModule"],
): PrerequisiteRuntime {
  return { probeFfmpeg, loadModule };
}

async function rejected(completion: Promise<void>): Promise<Error> {
  return completion.then(
    () => {
      throw new Error("Expected prerequisite check to fail");
    },
    error => error as Error,
  );
}

describe("Eris default engine prerequisites", () => {
  it("probes FFmpeg once with -version and follows Eris's native-first Opus order", async () => {
    const probeFfmpeg = vi.fn(async (_command: string, _args: readonly string[]) => undefined);
    const OpusScript = Object.assign(function OpusScript() {}, { Application: { AUDIO: 2049 } });
    const loadModule = vi.fn((name: string) => {
      if (name === "@discordjs/opus") throw new Error("native encoder unavailable");
      return OpusScript;
    });
    const check = createPrerequisiteCheck(ERIS_OPUS_MODULES, runtime(probeFfmpeg, loadModule));

    const first = check();
    const second = check();

    expect(second).toBe(first);
    await first;
    expect(probeFfmpeg).toHaveBeenCalledTimes(1);
    expect(probeFfmpeg).toHaveBeenCalledWith(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]);
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(ERIS_OPUS_MODULES);
  });

  it("constructs and disposes the native encoder before accepting it", async () => {
    const probeFfmpeg = vi.fn(async () => undefined);
    const dispose = vi.fn();
    class OpusEncoder {
      readonly delete = dispose;
    }
    const loadModule = vi.fn(() => ({ OpusEncoder }));

    await createPrerequisiteCheck(ERIS_OPUS_MODULES, runtime(probeFfmpeg, loadModule))();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(loadModule).toHaveBeenCalledWith("@discordjs/opus");
  });

  it("rejects loadable modules that cannot encode PCM", async () => {
    const probeFfmpeg = vi.fn(async () => undefined);
    const loadModule = vi.fn((name: string) => {
      if (name === "@discordjs/opus") return {};
      return { Application: { AUDIO: 2049 } };
    });

    const failure = await rejected(createPrerequisiteCheck(ERIS_OPUS_MODULES, runtime(probeFfmpeg, loadModule))());

    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED });
    expect(failure.message).toContain("Opus implementation");
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(ERIS_OPUS_MODULES);
  });

  it("returns safe FFmpeg guidance when the probe fails", async () => {
    const signed = "https://stream.example/audio?token=top-secret";
    const probeFfmpeg = vi.fn(async () => {
      throw new Error(`missing decoder for ${signed}`);
    });
    const loadModule = vi.fn(() => ({}));
    const failure = await rejected(createPrerequisiteCheck(ERIS_OPUS_MODULES, runtime(probeFfmpeg, loadModule))());

    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED });
    expect(failure.message).toContain("requires FFmpeg");
    expect(failure.message).not.toContain(signed);
    expect(failure.message).not.toContain("top-secret");
    expect(loadModule).not.toHaveBeenCalled();
  });

  it("returns safe Opus guidance when every Eris encoder is unavailable", async () => {
    const probeFfmpeg = vi.fn(async () => undefined);
    const loadModule = vi.fn((name: string) => {
      throw new Error(`cannot load ${name} with token=top-secret`);
    });
    const failure = await rejected(createPrerequisiteCheck(ERIS_OPUS_MODULES, runtime(probeFfmpeg, loadModule))());

    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED });
    expect(failure.message).toContain("Opus implementation");
    expect(failure.message).toContain("@discordjs/opus or opusscript");
    expect(failure.message).not.toContain("top-secret");
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(ERIS_OPUS_MODULES);
  });
});
