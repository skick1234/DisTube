import { DisTubeError, ErrorCode } from "distube";
import { describe, expect, it } from "vitest";
import { playbackRequest, positiveInteger } from "../src/validation";

const dispose = () => undefined;
const request = (resource: unknown): Readonly<Record<string, unknown>> => ({ itemId: "item", resource });

describe("playbackRequest", () => {
  it("returns the narrowed request for an absolute HTTP(S) URL resource", () => {
    const value = request({ kind: "url", url: "https://media.example/audio", dispose });
    expect(playbackRequest(value)).toBe(value);
    expect(playbackRequest(request({ kind: "url", url: "http://media.example/audio", dispose }))).toBeDefined();
  });

  it("rejects values that are not exactly itemId plus resource", () => {
    expect(() => playbackRequest(null)).toThrow("must be an object");
    expect(() => playbackRequest("request")).toThrow("must be an object");
    expect(() => playbackRequest({ itemId: "item" })).toThrow("only itemId and resource");
    expect(() => playbackRequest({ itemId: "", resource: {} })).toThrow("only itemId and resource");
    expect(() => playbackRequest({ itemId: "item", resource: {}, extra: true })).toThrow("only itemId and resource");
  });

  it("declines an encoded resource with UNSUPPORTED in the engine's own words", () => {
    let failure: unknown;
    try {
      playbackRequest(request({ kind: "encoded", encoded: "node-blob" }));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DisTubeError);
    expect(failure).toMatchObject({ code: ErrorCode.UNSUPPORTED });
  });

  it("rejects resources that are not valid URL resources", () => {
    expect(() => playbackRequest(request(undefined))).toThrow("URL resource");
    expect(() => playbackRequest(request("resource"))).toThrow("URL resource");
    expect(() => playbackRequest(request({ kind: "file", url: "https://media.example/audio", dispose }))).toThrow(
      "valid URL resource",
    );
    expect(() => playbackRequest(request({ kind: "url", url: 5, dispose }))).toThrow("valid URL resource");
    expect(() => playbackRequest(request({ kind: "url", url: "https://media.example/audio" }))).toThrow(
      "valid URL resource",
    );
  });

  it("rejects URLs that are not absolute HTTP(S)", () => {
    for (const url of ["not a url", "ftp://host/file", "file:///audio.ogg"]) {
      expect(() => playbackRequest(request({ kind: "url", url, dispose }))).toThrow("absolute HTTP(S) URL");
    }
  });
});

describe("positiveInteger", () => {
  it("returns positive integers and rejects everything else", () => {
    expect(positiveInteger(3, "count")).toBe(3);
    expect(() => positiveInteger(0, "count")).toThrow("count must be positive");
    expect(() => positiveInteger(1.5, "count")).toThrow("count must be positive");
  });
});
