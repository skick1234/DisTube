import { describe, expect, it } from "vitest";
import * as root from "../src";
import * as integrations from "../src/integrations";

describe("public entry points", () => {
  it("exports exactly the application runtime values from the root", () => {
    expect(Object.keys(root).sort()).toEqual(["DisTube", "DisTubeError", "ErrorCode", "Playlist", "Song"]);
  });

  it("exports only types from distube/integrations", () => {
    expect(Object.keys(integrations)).toEqual([]);
  });
});
