import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as root from "../src";
import * as integrations from "../src/integrations";

describe("public entry points", () => {
  it("exports exactly the application runtime values from the root", () => {
    expect(Object.keys(root).toSorted()).toEqual(["DisTube", "DisTubeError", "ErrorCode", "Playlist", "Song"]);
  });

  it("exports only types from distube/integrations", () => {
    expect(Object.keys(integrations)).toEqual([]);
  });

  it("loads the built root through require() with the same runtime values", () => {
    const loaded: object = createRequire(import.meta.url)("distube");

    expect(Object.keys(loaded).toSorted()).toEqual(["DisTube", "DisTubeError", "ErrorCode", "Playlist", "Song"]);
  });
});
