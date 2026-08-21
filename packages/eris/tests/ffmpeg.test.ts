import { beforeEach, describe, expect, it, vi } from "vitest";
import { ffmpegFailure, finishedFfmpeg, spawnFfmpeg } from "../src/ffmpeg";
import { latest, resetNative } from "./support/eris";

vi.mock("node:child_process", async () => (await import("./support/eris")).childProcessModule());

beforeEach(resetNative);

describe("FFmpeg diagnostics", () => {
  it("does not follow redirects after source validation", () => {
    spawnFfmpeg("https://stream.example/audio", 0);

    const input = latest.spawn.indexOf("-i");
    expect(latest.spawn.slice(input - 2, input + 2)).toEqual([
      "-max_redirects",
      "0",
      "-i",
      "https://stream.example/audio",
    ]);
  });

  it("keeps a spawn error when close follows it", async () => {
    const stream = spawnFfmpeg("https://stream.example/audio", 0);
    const failure = new Error("ffmpeg was not found");

    latest.child.emit("error", failure);
    latest.child.close(1, null);

    await expect(stream.outcome).resolves.toMatchObject({ code: null, signal: null, error: failure });
  });

  it("reports a signal exit as a decoder failure", async () => {
    const stream = spawnFfmpeg("https://stream.example/audio", 0);

    latest.child.close(null, "SIGTERM");

    await expect(stream.outcome).resolves.toMatchObject({ code: null, signal: "SIGTERM" });
    expect(ffmpegFailure({ code: null, signal: "SIGTERM", stderr: "" }).message).toContain(
      "FFmpeg exited from signal SIGTERM",
    );
  });

  it("redacts signed URLs, credential fields, and authorization headers", () => {
    const secrets = ["url-secret", "api-secret", "header-secret", "bearer-secret"];
    const failure = ffmpegFailure({
      code: 1,
      signal: null,
      stderr: [
        "decoder failed at https://stream.example/audio?token=url-secret",
        "api_key=api-secret",
        "Authorization: Bearer header-secret",
        "Bearer bearer-secret",
      ].join("\n"),
    });

    for (const secret of secrets) expect(failure.message).not.toContain(secret);
    expect(failure.message).toContain("<redacted>");
  });

  it("bounds public decoder diagnostics by UTF-8 bytes", () => {
    const failure = ffmpegFailure({
      code: 1,
      signal: null,
      stderr: "token=secret ".repeat(700),
      error: new Error("credential=secret ".repeat(700)),
    });

    expect(Buffer.byteLength(failure.message, "utf8")).toBeLessThanOrEqual(4096);
    expect(failure.message).not.toContain("secret");
  });

  it("accepts only an ordinary zero exit as a finished decode", () => {
    expect(finishedFfmpeg({ code: 0, signal: null, stderr: "" })).toBe(true);
    expect(finishedFfmpeg({ code: 1, signal: null, stderr: "" })).toBe(false);
    expect(finishedFfmpeg({ code: null, signal: "SIGKILL", stderr: "" })).toBe(false);
    expect(finishedFfmpeg({ code: null, signal: null, stderr: "", error: new Error("spawn failed") })).toBe(false);
  });
});
