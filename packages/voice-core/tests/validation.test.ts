import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { localPlaybackResource } from "../src/validation";

describe("local input validation", () => {
  it("copies and freezes headers without freezing the caller", () => {
    const headers = { Authorization: "private" };
    const value = localPlaybackResource({ kind: "url", url: "https://example.test/audio", headers });
    headers.Authorization = "changed";
    expect(value).toMatchObject({ headers: { Authorization: "private" } });
    expect(Object.isFrozen(value)).toBe(true);
    if (value.kind === "url") expect(Object.isFrozen(value.headers)).toBe(true);
  });
  it.each([
    "Host",
    "Connection",
    "Transfer-Encoding",
    "Content-Length",
    "Proxy-Authorization",
    "Proxy-Connection",
    "TE",
    "Range",
  ])("rejects %s override", name => {
    expect(() =>
      localPlaybackResource({ kind: "url", url: "https://example.test", headers: { [name]: "x" } }),
    ).toThrow();
  });
  it.each([{ "bad name": "x" }, { Authorization: "x\r\nInjected: y" }, { X: "x\tx" }, { X: "\x7f" }])(
    "rejects invalid headers",
    headers => {
      expect(() => localPlaybackResource({ kind: "url", url: "https://example.test", headers })).toThrow();
    },
  );
  it.each(["https://user:password@example.test", "file:///audio", "/audio"])("rejects URL %s", url => {
    expect(() => localPlaybackResource({ kind: "url", url })).toThrow();
  });
  it("requires absolute files and retains native stream mutability", () => {
    expect(() => localPlaybackResource({ kind: "file", path: "audio.wav" })).toThrow();
    expect(() => localPlaybackResource({ kind: "file", path: "/audio\0.wav" })).toThrow();
    const stream = new PassThrough();
    expect(localPlaybackResource({ kind: "stream", stream })).toMatchObject({ stream });
    expect(Object.isFrozen(stream)).toBe(false);
    stream.destroy();
  });
  it.each([
    { kind: "reader", size: 0, container: "webm", read: () => new PassThrough() },
    { kind: "reader", size: 10, container: "ogg", read: () => new PassThrough() },
    { kind: "reader", size: 10, container: "webm" },
    { kind: "timed", container: "mp4", open: "later" },
    { kind: "timed", container: "mp4", open: () => new PassThrough(), size: 10 },
  ])("rejects malformed seekable resource %#", value => {
    expect(() => localPlaybackResource(value)).toThrow(TypeError);
  });
  it("accepts reader and timed resources and refuses a callback that returns no Readable", () => {
    const reader = localPlaybackResource({ kind: "reader", size: 10, container: "webm", read: () => "bytes" });
    const timed = localPlaybackResource({ kind: "timed", container: "mp4", open: () => new PassThrough() });
    expect(Object.isFrozen(reader) && Object.isFrozen(timed)).toBe(true);
    if (reader.kind !== "reader" || timed.kind !== "timed") throw new Error("Expected seekable resources");
    expect(() => reader.read(0, 9, new AbortController().signal)).toThrow(TypeError);
    expect(timed.open(5, new AbortController().signal)).toBeInstanceOf(PassThrough);
  });
});
