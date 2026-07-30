import { describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../src";
import {
  validatePlaybackPreparation,
  validatePlaybackRequest,
  validateSourceName,
  validateUrlPlaybackResource,
} from "../src/playback/validation";

const resource = () => ({
  kind: "url" as const,
  url: "https://stream.example/audio?signature=secret",
  dispose: vi.fn(),
});

describe("playback contract validation", () => {
  it.each(["", " source", "source ", "\t"])("rejects a non-exact source name without reflecting it", value => {
    expect(() => validateSourceName(value)).toThrowError(expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT }));
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
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT }),
    );
  });

  it.each([
    { kind: "url", url: "/relative", dispose: vi.fn() },
    { kind: "url", url: "file:///tmp/audio", dispose: vi.fn() },
    { kind: "url", url: "https://stream.example/audio" },
    { kind: "stream", url: "https://stream.example/audio", dispose: vi.fn() },
  ])("rejects malformed resources without exposing their URL %#", value => {
    try {
      validateUrlPlaybackResource(value);
      throw new Error("expected resource validation to fail");
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
      expect((error as Error).message).not.toContain(String(value.url));
    }
  });

  it("accepts only item ID and resource in a playback request", () => {
    const valid = resource();
    expect(validatePlaybackRequest({ itemId: "item-1", resource: valid })).toEqual({
      itemId: "item-1",
      resource: valid,
    });
    expect(() => validatePlaybackRequest({ itemId: "item-1", resource: valid, song: {} })).toThrowError(
      expect.objectContaining({ code: ErrorCode.INVALID_ARGUMENT }),
    );
  });

  it("never includes a credentialed resource URL in validation errors", () => {
    const secret = "https://user:password@example.test/path?token=secret#fragment";
    expect(() => validateUrlPlaybackResource({ kind: "url", url: secret, dispose: "no" })).toThrowError(
      expect.not.objectContaining({ message: expect.stringContaining(secret) }),
    );
  });
});
