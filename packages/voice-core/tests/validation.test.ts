import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { localPlaybackResource, playbackRequest } from "../src/validation";

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
    const request = playbackRequest({ itemId: "a", resource: { kind: "stream", stream } });
    expect(request.resource).toMatchObject({ stream });
    expect(Object.isFrozen(stream)).toBe(false);
    stream.destroy();
  });
});
