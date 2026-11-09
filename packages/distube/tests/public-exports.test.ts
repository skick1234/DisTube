import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as root from "../src";

describe("public entry points", () => {
  it("exports exactly the application runtime values from the root", () => {
    expect(Object.keys(root).toSorted()).toEqual(["DisTube", "DisTubeError", "ErrorCode", "Playlist", "Song"]);
  });

  it("loads distube/integrations at runtime with only the retry helper as values", async () => {
    const integrations: object = await import("distube/integrations");

    expect(Object.keys(integrations).toSorted()).toEqual(["isTransientFailure", "retryRequest"]);
  });

  it("loads the built root through require() with the same runtime values", () => {
    const loaded: object = createRequire(import.meta.url)("distube");

    expect(Object.keys(loaded).toSorted()).toEqual(["DisTube", "DisTubeError", "ErrorCode", "Playlist", "Song"]);
  });
});
