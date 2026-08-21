import { beforeEach, describe, expect, it, vi } from "vitest";
import { ffmpegFailure, spawnFfmpeg } from "../src/ffmpeg";
import { latest, resetNative } from "./support/native";

vi.mock("node:child_process", async () => (await import("./support/native")).childProcessModule());

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

  it("redacts underscore and hyphen credential fields plus signed request headers", () => {
    const secrets = [
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
});
