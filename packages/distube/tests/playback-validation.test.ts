import { describe, expect, it, vi } from "vitest";
import { DisTubeError } from "../src";
import { abortFailure, asDisTubeError } from "../src/errors";
import {
  validatePlaybackPreparation,
  validatePlaybackRequest,
  validatePlaybackResource,
  validateSourceName,
} from "../src/playback/validation";

const resource = () => ({
  kind: "url" as const,
  url: "https://stream.example/audio?signature=secret",
  dispose: vi.fn(),
});

describe("playback contract validation", () => {
  it.each(["", " source", "source ", "\t"])("rejects a non-exact source name without reflecting it", value => {
    expect(() => validateSourceName(value)).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });

  it("normalizes a non-empty search preparation", () => {
    expect(validatePlaybackPreparation({ kind: "search", query: "  title artist  " })).toEqual({
      kind: "search",
      query: "title artist",
    });
  });

  it.each([
    undefined,
    {},
    { kind: "other" },
    { kind: "search", query: "   " },
    { kind: "search", query: "query", resource: resource() },
  ])("rejects malformed preparation %#", value => {
    expect(() => validatePlaybackPreparation(value)).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
  });

  it.each([
    { kind: "url", url: "/relative", dispose: vi.fn() },
    { kind: "url", url: "file:///tmp/audio", dispose: vi.fn() },
    { kind: "url", url: "https://stream.example/audio" },
    { kind: "stream", url: "https://stream.example/audio", dispose: vi.fn() },
  ])("rejects malformed resources without exposing their URL %#", value => {
    try {
      validatePlaybackResource(value);
      throw new Error("expected resource validation to fail");
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: "INVALID_ARGUMENT" });
      expect((error as Error).message).not.toContain(String(value.url));
    }
  });

  it("accepts an encoded resource and rejects malformed ones", () => {
    const encoded = { kind: "encoded" as const, encoded: "QAAAj...", dispose: vi.fn() };
    expect(validatePlaybackResource(encoded)).toBe(encoded);
    for (const value of [
      { kind: "encoded", encoded: "", dispose: vi.fn() },
      { kind: "encoded", encoded: "track", url: "https://stream.example/audio", dispose: vi.fn() },
      { kind: "encoded", encoded: "track" },
    ]) {
      expect(() => validatePlaybackResource(value)).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    }
  });

  it("accepts only item ID and resource in a playback request", () => {
    const valid = resource();
    expect(validatePlaybackRequest({ itemId: "item-1", resource: valid })).toEqual({
      itemId: "item-1",
      resource: valid,
    });
    expect(() => validatePlaybackRequest({ itemId: "item-1", resource: valid, song: {} })).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
  });

  it("never includes a credentialed resource URL in validation errors", () => {
    const secret = "https://user:password@example.test/path?token=secret#fragment";
    expect(() => validatePlaybackResource({ kind: "url", url: secret, dispose: "no" })).toThrowError(
      expect.not.objectContaining({ message: expect.stringContaining(secret) }),
    );
  });
});

describe("error boundaries", () => {
  it("preserves Error cancellation reasons and omits arbitrary caller data", () => {
    const reason = new DisTubeError("INVALID_STATE", "Caller reason");
    expect(abortFailure(reason)).toMatchObject({ code: "ABORTED", cause: reason });
    expect(abortFailure("https://example.test/?secret=token").cause).toBeUndefined();
  });

  it("preserves normalized failures once, including aggregates", () => {
    const failures = [new Error("first"), new Error("second")];
    const cause = new AggregateError(failures, "Cleanup failed");
    const error = asDisTubeError("SOURCE_FAILED", "Source cleanup failed", cause);
    expect(error.cause).toBe(cause);
    expect(asDisTubeError("SOURCE_FAILED", "Source failed", error)).toBe(error);
    expect(asDisTubeError("VOICE_FAILED", "Voice failed", error).cause).toBe(error);
    expect(cause.errors).toEqual(failures);
  });
});
