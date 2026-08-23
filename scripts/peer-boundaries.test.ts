import { describe, expect, it } from "bun:test";
import { inspectPeerCoverage, selectPeerBoundaries } from "./peer-boundaries";

const PUBLISHED = ["1.13.0", "1.14.0", "1.15.0", "2.0.0", "1.16.0-beta.1"];
const boundariesFor = (_name: string, range: string) => selectPeerBoundaries(PUBLISHED, range);

const matrix = (lower: string, latest: string) => [
  { name: "lower", dependencies: { "oceanic.js": lower } },
  { name: "latest", dependencies: { "oceanic.js": latest } },
];

describe("selectPeerBoundaries", () => {
  it("bounds a caret range by its lowest and highest stable members", () => {
    expect(selectPeerBoundaries(PUBLISHED, "^1.14.0")).toEqual({ floor: "1.14.0", ceiling: "1.15.0" });
  });

  it("collapses to one version when the range admits only one", () => {
    expect(selectPeerBoundaries(["0.18.0", "0.17.2"], "^0.18.0")).toEqual({ floor: "0.18.0", ceiling: "0.18.0" });
  });

  it("refuses a range no published version satisfies", () => {
    expect(() => selectPeerBoundaries(PUBLISHED, "^3.0.0")).toThrow("No published version satisfies ^3.0.0");
  });
});

describe("inspectPeerCoverage", () => {
  it("accepts a matrix pinning both boundaries", () => {
    expect(inspectPeerCoverage("a", { "oceanic.js": "^1.14.0" }, matrix("1.14.0", "1.15.0"), boundariesFor)).toEqual(
      [],
    );
  });

  it("rejects two cases that pin the same version", () => {
    expect(inspectPeerCoverage("a", { "oceanic.js": "^1.14.0" }, matrix("1.14.0", "1.14.0"), boundariesFor)).toEqual([
      "a: oceanic.js range ^1.14.0 is unexercised at 1.15.0",
    ]);
  });

  it("accepts duplicate pins when the range admits a single version", () => {
    const single = (_name: string, range: string) => selectPeerBoundaries(["0.18.0"], range);
    const cases = [
      { name: "lower", dependencies: { eris: "0.18.0" } },
      { name: "latest", dependencies: { eris: "0.18.0" } },
    ];
    expect(inspectPeerCoverage("a", { eris: "^0.18.0" }, cases, single)).toEqual([]);
  });

  it("rejects a pin outside the declared range", () => {
    expect(inspectPeerCoverage("a", { "oceanic.js": "^1.14.0" }, matrix("1.13.0", "1.15.0"), boundariesFor)).toEqual([
      "a: oceanic.js@1.13.0 is outside the declared range ^1.14.0",
      "a: oceanic.js range ^1.14.0 is unexercised at 1.14.0",
    ]);
  });

  it("names the cases that leave a peer unpinned", () => {
    const cases = [
      { name: "lower", dependencies: {} },
      { name: "latest", dependencies: { "oceanic.js": "1.15.0" } },
    ];
    expect(inspectPeerCoverage("a", { "oceanic.js": "^1.14.0" }, cases, boundariesFor)).toEqual([
      "a: oceanic.js is unpinned in case lower",
    ]);
  });

  it("rejects an adapter that declares no peer to exercise", () => {
    expect(inspectPeerCoverage("a", {}, matrix("1.14.0", "1.15.0"), boundariesFor)).toEqual([
      "a: declares no peer dependency to exercise",
    ]);
  });
});
