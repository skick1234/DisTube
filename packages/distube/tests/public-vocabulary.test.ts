import { describe, expect, it } from "vitest";
import { DisTubeError, type ErrorCode, type PlaybackStatus, type RepeatMode } from "../src";

describe("public literal vocabulary", () => {
  it("accepts literal codes without runtime enum members", () => {
    const codes = [
      "INVALID_ARGUMENT",
      "INVALID_STATE",
      "ABORTED",
      "SOURCE_FAILED",
      "VOICE_FAILED",
      "PLUGIN_FAILED",
      "QUEUE_FAILED",
      "UNSUPPORTED",
    ] satisfies ErrorCode[];
    for (const code of codes) expect(new DisTubeError(code, "Operation failed").code).toBe(code);
  });

  it("accepts literal repeat modes and queue statuses", () => {
    const modes = ["off", "song", "queue"] satisfies RepeatMode[];
    const statuses = ["idle", "playing", "paused"] satisfies PlaybackStatus[];
    expect(modes).toContain("song");
    expect(statuses).toContain("paused");
  });
});
