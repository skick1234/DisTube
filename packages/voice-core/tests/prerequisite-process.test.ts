import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrerequisiteCheck } from "../src/prerequisites";

const processMock = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", async importOriginal => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: processMock.spawn,
}));

const modules = { owner: "test-owner", opus: [], encryption: [] };

async function failureOf(completion: Promise<void>): Promise<Error> {
  const failure: unknown = await completion.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(failure instanceof Error)) throw new Error("Expected an Error from the prerequisite check");
  return failure;
}

beforeEach(() => {
  processMock.spawn.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("local FFmpeg process prerequisite", () => {
  it("turns a synchronous spawn failure into safe guidance and can retry the local command", async () => {
    processMock.spawn.mockImplementationOnce(() => {
      throw new Error("failed to start private-decoder-command");
    });
    const check = createPrerequisiteCheck(modules);

    const first = await failureOf(check());
    expect(first).toMatchObject({ code: "VOICE_FAILED" });
    expect(first.message).toContain("requires FFmpeg");
    expect(first.message).not.toContain("private-decoder-command");

    const child = new EventEmitter();
    processMock.spawn.mockReturnValueOnce(child);
    const second = check();
    child.emit("close", 0, null);
    const secondFailure = await failureOf(second);
    expect(secondFailure).toMatchObject({ code: "VOICE_FAILED" });
    expect(secondFailure.message).toContain("Opus implementation");
    expect(processMock.spawn).toHaveBeenCalledTimes(2);
  });

  it("settles once when the child reports an error and then closes", async () => {
    const child = new EventEmitter();
    processMock.spawn.mockReturnValueOnce(child);
    const check = createPrerequisiteCheck(modules);
    const completion = check();

    child.emit("error", new Error("decoder path: /private/ffmpeg"));
    child.emit("close", 1, null);

    const failure = await failureOf(completion);
    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.message).toContain("requires FFmpeg");
    expect(failure.message).not.toContain("/private/ffmpeg");
  });

  it.each([
    { code: 1, signal: null, advances: false },
    { code: null, signal: "SIGTERM", advances: false },
    { code: 0, signal: null, advances: true },
  ])("recognizes whether a completed probe can advance to module checks", async ({ code, signal, advances }) => {
    const child = new EventEmitter();
    processMock.spawn.mockReturnValueOnce(child);
    const completion = createPrerequisiteCheck(modules)();

    child.emit("close", code, signal);

    const failure = await failureOf(completion);
    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.message).toContain(advances ? "Opus implementation" : "requires FFmpeg");
  });
});
