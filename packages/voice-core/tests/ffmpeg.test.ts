import { beforeEach, describe, expect, it, vi } from "vitest";
import { ffmpegFailure, finishedFfmpeg, spawnFfmpeg } from "../src/ffmpeg";
import { latest, resetNative } from "./support/native";

vi.mock("node:child_process", async () => (await import("./support/native")).childProcessModule());

beforeEach(resetNative);

describe("FFmpeg diagnostics", () => {
  it("keeps a spawn error when close follows it", async () => {
    const stream = await spawnFfmpeg({ kind: "file", path: "/audio.wav" }, 0);
    const failure = new Error("ffmpeg was not found");

    latest.child.emit("error", failure);
    latest.child.close(1, null);

    const outcome = await stream.outcome;
    expect(outcome.error?.message).toContain(failure.message);
    expect(ffmpegFailure(outcome).cause).toBeInstanceOf(Error);
  });

  it("keeps the latest bounded stderr tail", async () => {
    const stream = await spawnFfmpeg({ kind: "file", path: "/audio.wav" }, 0);
    latest.child.stderr.write(`discarded-prefix-${"x".repeat(5_000)}`);
    latest.child.stderr.write("\nlatest-stderr-tail");
    latest.child.close(1, null);

    const outcome = await stream.outcome;
    expect(outcome.stderr).toContain("latest-stderr-tail");
    expect(outcome.stderr).not.toContain("discarded-prefix");
    expect(Buffer.byteLength(outcome.stderr, "utf8")).toBeLessThanOrEqual(4096);
  });

  it("drops clipped diagnostic lines rather than exposing credential tails", async () => {
    const run = await spawnFfmpeg({ kind: "file", path: "/audio.wav" }, 0);
    latest.child.stderr.write(`Authorization: ${"private".repeat(1000)}`);
    latest.child.close(1, null);
    expect((await run.outcome).stderr).not.toContain("private");
  });
  it("redacts a private file path from decoder stderr", async () => {
    const path = "/private/audio.wav";
    const run = await spawnFfmpeg({ kind: "file", path }, 0);
    latest.child.stderr.write(`failed to read ${path}`);
    latest.child.close(1, null);
    const failure = ffmpegFailure(await run.outcome);
    expect(failure.message).not.toContain(path);
    expect(failure.message).toContain("<redacted>");
  });
  it("preserves native decoder causes and codes without retaining a private file path", async () => {
    const path = "/private/audio.wav";
    const nativeCause = new TypeError(`could not open ${path}`);
    const nativeError = Object.assign(new Error(`decoder failed at ${path}`, { cause: nativeCause }), {
      code: "ENOENT",
    });
    const run = await spawnFfmpeg({ kind: "file", path }, 0);
    latest.child.emit("error", nativeError);
    const failure = ffmpegFailure(await run.outcome);
    const inputError = failure.cause as Error;
    const decoderError = inputError.cause as Error & { code?: string };
    const decoderCause = decoderError.cause as Error;
    expect(inputError).toBeInstanceOf(Error);
    expect(decoderError).not.toBe(nativeError);
    expect(decoderError.code).toBe("ENOENT");
    expect(decoderCause.name).toBe("TypeError");
    expect(decoderCause).not.toBe(nativeCause);
    for (const error of [failure, inputError, decoderError, decoderCause]) {
      expect(error.message).not.toContain(path);
    }
  });
  it("bounds cyclic and oversized native error graphs", async () => {
    const cycle = new Error("token=private");
    Object.defineProperty(cycle, "cause", { value: cycle });
    const nativeError = new AggregateError(
      Array.from({ length: 30 }, (_, index) => new Error(`error ${index} secret=private`)),
      "many decoder failures",
      { cause: cycle },
    );
    const run = await spawnFfmpeg({ kind: "file", path: "/audio.wav" }, 0);
    latest.child.emit("error", nativeError);
    const failure = ffmpegFailure(await run.outcome);
    const aggregate = (failure.cause as Error).cause as AggregateError;
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect(aggregate.errors.length).toBeLessThanOrEqual(12);
    expect(((aggregate.cause as Error).cause as Error).message).toContain("Cyclic error cause");
    for (const child of aggregate.errors as Error[]) expect(child.message).not.toContain("private");
  });

  it("reports a signal exit as a decoder failure", async () => {
    const stream = await spawnFfmpeg({ kind: "file", path: "/audio.wav" }, 0);

    latest.child.close(null, "SIGTERM");

    await expect(stream.outcome).resolves.toMatchObject({ code: null, signal: "SIGTERM" });
    expect(ffmpegFailure({ code: null, signal: "SIGTERM", stderr: "" }).message).toContain(
      "FFmpeg exited from signal SIGTERM",
    );
  });

  it("redacts underscore and hyphen credential fields plus signed request headers", () => {
    const secrets = [
      "url-secret",
      "api-key-secret",
      "access-token-secret",
      "refresh-token-secret",
      "client-secret-value",
      "header-secret",
      "aws-signature",
      "bearer-secret",
    ];
    const failure = ffmpegFailure({
      code: 1,
      signal: null,
      stderr: [
        "decoder failed at https://stream.example/audio?token=url-secret",
        "api_key=api-key-secret",
        "access-token=access-token-secret",
        "refresh_token=refresh-token-secret",
        "client-secret=client-secret-value",
        "X-Api-Key: header-secret",
        "X-Amz-Security-Token: header-secret",
        "Signature=aws-signature",
        "Authorization: AWS4-HMAC-SHA256 Credential=header-secret, SignedHeaders=host, Signature=aws-signature",
        "Bearer bearer-secret",
      ].join("\n"),
    });

    for (const secret of secrets) expect(failure.message).not.toContain(secret);
    expect(failure.message).toContain("<redacted>");
  });

  it("bounds redacted input and the complete public error by UTF-8 bytes", () => {
    const failure = ffmpegFailure({
      code: 1,
      signal: null,
      stderr: "key=x ".repeat(700),
      error: new Error("secret=y ".repeat(700)),
    });

    expect(Buffer.byteLength(failure.message, "utf8")).toBeLessThanOrEqual(4096);
    expect(failure.message).not.toContain("secret=y");
  });

  it("accepts only an ordinary zero exit as a finished decode", () => {
    expect(finishedFfmpeg({ code: 0, signal: null, stderr: "" })).toBe(true);
    expect(finishedFfmpeg({ code: 1, signal: null, stderr: "" })).toBe(false);
    expect(finishedFfmpeg({ code: null, signal: "SIGKILL", stderr: "" })).toBe(false);
    expect(finishedFfmpeg({ code: null, signal: null, stderr: "", error: new Error("spawn failed") })).toBe(false);
  });
});
