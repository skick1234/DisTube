import { describe, expect, it } from "vitest";
import { abortFailure, asDisTubeError, asError, DisTubeError, ErrorCode } from "../src/errors";

function graph(error: Error): Error[] {
  return [
    error,
    ...(error.cause instanceof Error ? graph(error.cause) : []),
    ...(error instanceof AggregateError ? error.errors.flatMap(graph) : []),
  ];
}
function text(error: Error): string {
  return graph(error)
    .map(value => `${value.name} ${value.message} ${value.stack}`)
    .join("\n");
}

describe("safe error boundaries", () => {
  it("preserves safe provider errors and wraps ordinary errors only once", () => {
    const cause = new Error("provider unavailable");
    const failure = asDisTubeError(ErrorCode.SOURCE_FAILED, "Source failed", cause);
    expect(failure.cause).toBe(cause);
    expect(asDisTubeError(ErrorCode.SOURCE_FAILED, "Source failed", failure)).toBe(failure);
    const plugin = new DisTubeError("SPOTIFY_NOT_FOUND", "No matching track", { cause });
    expect(asDisTubeError(ErrorCode.SOURCE_FAILED, "Source failed", plugin)).toBe(plugin);
  });
  it("reclassifies a plugin code only when the native boundary requests it", () => {
    const plugin = new DisTubeError("SPOTIFY_NOT_FOUND", "No matching track");
    const failure = asDisTubeError(ErrorCode.VOICE_FAILED, "Player failed", plugin, { reclassify: true });
    expect(failure.code).toBe(ErrorCode.VOICE_FAILED);
    expect(failure.cause).toBe(plugin);
  });
  it("sanitizes nested operation and cleanup failures without retaining unsafe originals", () => {
    const path = "/private/audio/demo.mp3";
    const primary = new Error(`Cannot open ${path}`);
    const cleanup = Object.assign(new Error("Authorization: Bearer credential"), { request: { token: "credential" } });
    const plugin = new DisTubeError("PROVIDER_FAILED", "Playback failed", {
      cause: new AggregateError([primary, cleanup], "Operation and cleanup failed"),
    });
    const safe = asDisTubeError(ErrorCode.SOURCE_FAILED, "Source failed", plugin, { sensitiveValues: [path] });
    expect(safe.code).toBe("PROVIDER_FAILED");
    expect(safe.cause).toBeInstanceOf(AggregateError);
    expect((safe.cause as AggregateError).errors).toHaveLength(2);
    expect(text(safe)).not.toContain(path);
    expect(text(safe)).not.toContain("credential");
    for (const original of [primary, cleanup, plugin, plugin.cause]) expect(graph(safe)).not.toContain(original);
    expect(graph(safe).every(value => !("request" in value))).toBe(true);
  });
  it("redacts unsafe stack content even when the message is safe", () => {
    const failure = new Error("Failed");
    failure.stack = "Error: Failed\n at https://user:password@host/audio?signature=signed-secret";
    const safe = asError(failure);
    expect(safe).not.toBe(failure);
    expect(text(safe)).not.toContain("password");
    expect(text(safe)).not.toContain("signed-secret");
  });
  it("copies an AggregateError when its member array carries extra properties", () => {
    const failure = new AggregateError([new Error("safe member")], "failed");
    Object.assign(failure.errors, { token: "private-token" });
    const safe = asError(failure);
    expect(safe).not.toBe(failure);
    expect(safe).toBeInstanceOf(AggregateError);
    expect((safe as AggregateError).errors).toHaveLength(1);
    expect(Object.hasOwn((safe as AggregateError).errors, "token")).toBe(false);

    const plain = new AggregateError([new Error("safe member")], "failed");
    expect(asError(plain)).toBe(plain);
  });
  it("keeps readable aggregate members when another member is an accessor", () => {
    const failure = new AggregateError([new Error("first"), new Error("second")], "failed");
    Object.defineProperty(failure.errors, "1", {
      get: () => {
        throw new Error("private accessor result");
      },
    });
    const safe = asError(failure);
    expect(safe).toBeInstanceOf(AggregateError);
    expect((safe as AggregateError).errors.map((member: Error) => member.message)).toEqual([
      "first",
      "Malformed aggregate member omitted",
    ]);
    expect(text(safe)).not.toContain("private accessor result");
  });
  it("copies error subclasses whose prototype exposes native fields", () => {
    class ProviderError extends Error {
      get credentials(): string {
        return "private-token";
      }
    }
    const failure = new ProviderError("provider failed", { cause: new Error("request failed") });
    const safe = asError(failure);
    expect(safe).not.toBe(failure);
    expect(safe.name).toBe("Error");
    expect(safe.cause).toBeInstanceOf(Error);
    expect("credentials" in safe).toBe(false);
  });
  it("bounds cycles, aggregate width, depth and text", () => {
    const cycle = new Error("x".repeat(20_000));
    cycle.cause = cycle;
    let deep: Error = cycle;
    for (let index = 0; index < 30; index++) deep = new Error("nested", { cause: deep });
    const safe = asError(
      new AggregateError(
        Array.from({ length: 100 }, () => deep),
        "Many failures",
      ),
    );
    const nodes = graph(safe);
    expect(nodes.length).toBeLessThan(150);
    expect(nodes.every(value => value.message.length <= 512)).toBe(true);
    expect(text(asError(cycle))).toContain("Circular error cause omitted");
    expect(nodes).not.toContain(cycle);
  });
  it("does not reflect arbitrary cancellation or cause objects", () => {
    expect(abortFailure("private abort reason").cause).toBeUndefined();
    const safe = asError(new Error("Failure", { cause: { credentials: "private cause" } }));
    expect(safe.cause).toBeInstanceOf(Error);
    expect(text(safe)).not.toContain("private cause");
  });
});
