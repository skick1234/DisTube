import { describe, expect, it } from "vitest";
import { DisTubeError, ErrorCode } from "../src";

describe("public literal vocabulary", () => {
  it("narrows through DisTubeError.is for core and plugin-owned codes", () => {
    const aborted: unknown = new DisTubeError(ErrorCode.ABORTED, "cancelled");
    expect(DisTubeError.is(aborted, ErrorCode.ABORTED)).toBe(true);
    expect(DisTubeError.is(aborted, ErrorCode.INVALID_STATE)).toBe(false);
    expect(DisTubeError.is(new Error("plain"), ErrorCode.ABORTED)).toBe(false);
    const plugin: unknown = new DisTubeError("SPOTIFY_NOT_FOUND", "not on Spotify");
    expect(DisTubeError.is(plugin, "SPOTIFY_NOT_FOUND")).toBe(true);
  });
});
