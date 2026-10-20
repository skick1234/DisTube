import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { consumePlaybackResource } from "../src/playback/resource";
import { validatePlaybackPreparation, validatePlaybackResource, validateSourceName } from "../src/playback/validation";

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
    { kind: "stream", url: "https://stream.example/audio", dispose: vi.fn() },
    { kind: "url", url: "https://user:password@example.test/path?token=secret#fragment", dispose: vi.fn() },
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
    const encoded = { kind: "encoded" as const, format: "test.encoded", encoded: "QAAAj...", dispose: vi.fn() };
    expect(validatePlaybackResource(encoded)).toMatchObject({
      kind: "encoded",
      format: "test.encoded",
      encoded: "QAAAj...",
    });
    for (const value of [
      { kind: "encoded", format: "test.encoded", encoded: "", dispose: vi.fn() },
      {
        kind: "encoded",
        format: "test.encoded",
        encoded: "track",
        url: "https://stream.example/audio",
        dispose: vi.fn(),
      },
      { kind: "encoded", encoded: "track" },
    ]) {
      expect(() => validatePlaybackResource(value)).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    }
  });

  it.each(["Host", "Connection", "Content-Length", "Proxy-Authorization", "Proxy-Connection", "TE"])(
    "rejects the %s header before adopting direct input",
    name => {
      const dispose = vi.fn();
      const input = { kind: "url", url: "https://stream.example/audio", headers: { [name]: "private" }, dispose };
      expect(() => consumePlaybackResource(input)).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
      expect(dispose).not.toHaveBeenCalled();
    },
  );

  it.each(["x\0y", "x\ty", "x\ry", "x\ny", "x\x7fy"])("rejects a control character in a header value", value => {
    expect(() =>
      validatePlaybackResource({ kind: "url", url: "https://stream.example/audio", headers: { X: value } }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });

  it("copies special header names without mutating the caller or losing the value", async () => {
    const headers = JSON.parse('{"__proto__":"private","X-Test":"original"}') as Record<string, string>;
    const input = { kind: "url" as const, url: "https://stream.example/audio", headers, dispose: vi.fn() };
    const owned = consumePlaybackResource(input);
    headers["X-Test"] = "changed";
    expect(owned.resource).toMatchObject({ headers: { "X-Test": "original" } });
    if (owned.resource.kind !== "url") throw new Error("Expected URL resource");
    expect(Object.getPrototypeOf(owned.resource.headers)).toBe(null);
    expect(Object.getOwnPropertyDescriptor(owned.resource.headers, "__proto__")?.value).toBe("private");
    expect(Object.isFrozen(owned.resource.headers)).toBe(true);
    expect(input.headers["X-Test"]).toBe("changed");
    await owned.dispose();
    expect(input.dispose).toHaveBeenCalledOnce();
  });

  it("does not claim malformed direct input before its headers are corrected", async () => {
    const headers = { Authorization: "private\tvalue" };
    const dispose = vi.fn();
    const input = { kind: "url" as const, url: "https://stream.example/audio", headers, dispose };
    expect(() => consumePlaybackResource(input)).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(dispose).not.toHaveBeenCalled();
    headers.Authorization = "valid value";
    const owned = consumePlaybackResource(input);
    await owned.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each([
    { kind: "reader", size: 0, container: "webm", read: vi.fn() },
    { kind: "reader", size: 1.5, container: "webm", read: vi.fn() },
    { kind: "reader", size: 1000, container: "ogg", read: vi.fn() },
    { kind: "reader", size: 1000, container: "webm" },
    { kind: "reader", size: 1000, container: "webm", read: vi.fn(), url: "https://stream.example/audio" },
    { kind: "timed", container: "mp4", open: "later" },
    { kind: "timed", open: vi.fn() },
  ])("rejects malformed seekable resource %# without disposal", value => {
    const dispose = vi.fn();
    expect(() => consumePlaybackResource({ ...value, dispose })).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
    expect(dispose).not.toHaveBeenCalled();
  });

  it("adopts reader and timed resources and forwards their callbacks", async () => {
    const bytes = new PassThrough();
    const read = vi.fn((_start: number, _end: number, _signal: AbortSignal) => bytes);
    const reader = { kind: "reader" as const, size: 1000, container: "webm" as const, read, dispose: vi.fn() };
    const owned = consumePlaybackResource(reader);
    if (owned.resource.kind !== "reader") throw new Error("Expected reader resource");
    expect(owned.resource).toMatchObject({ kind: "reader", size: 1000, container: "webm" });
    expect(Object.isFrozen(owned.resource)).toBe(true);
    const signal = new AbortController().signal;
    expect(owned.resource.read(200, 299, signal)).toBe(bytes);
    expect(read).toHaveBeenCalledWith(200, 299, signal);
    await owned.dispose();
    expect(reader.dispose).toHaveBeenCalledOnce();

    const open = vi.fn((_seconds: number, _signal: AbortSignal) => bytes);
    const timed = consumePlaybackResource({ kind: "timed", container: "mp4", open });
    if (timed.resource.kind !== "timed") throw new Error("Expected timed resource");
    expect(timed.resource.open(90, signal)).toBe(bytes);
    expect(open).toHaveBeenCalledWith(90, signal);
  });
});
