import { describe, expect, test } from "bun:test";
import { type CoveragePolicyInput, inspectCoveragePolicy } from "./check-critical-quality";

const valid: CoveragePolicyInput = {
  packageName: "package",
  sourceFiles: ["src/index.ts", "src/private/runtime.ts"],
  testFiles: ["tests/runtime.test.ts"],
  include: ["src/**/*.ts"],
  exclude: [],
  thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
  floors: { statements: 90, branches: 85, functions: 90, lines: 90 },
};

describe("critical coverage inventory", () => {
  test("accepts one complete production-source owner at the required floors", () => {
    expect(inspectCoveragePolicy(valid)).toEqual([]);
  });

  test("rejects omitted, excluded, duplicate, empty, and below-floor inputs", () => {
    expect(
      inspectCoveragePolicy({
        ...valid,
        sourceFiles: ["src/runtime.ts", "outside/runtime.ts"],
        testFiles: [],
        include: ["src/**/*.ts", "src/**/*.ts"],
        exclude: ["src/runtime.ts"],
        thresholds: { statements: 89, branches: 84, functions: 89, lines: 89 },
      }),
    ).toEqual([
      "package: owning test inventory is empty",
      "package: coverage include inventory contains duplicates",
      "package: coverage scope selects src/runtime.ts 2 times",
      "package: coverage excludes src/runtime.ts",
      "package: coverage scope omits outside/runtime.ts",
      "package: statements threshold 89 is below required 90",
      "package: branches threshold 84 is below required 85",
      "package: functions threshold 89 is below required 90",
      "package: lines threshold 89 is below required 90",
    ]);
    expect(inspectCoveragePolicy({ ...valid, sourceFiles: [], include: [] })).toContain(
      "package: production source inventory is empty",
    );
  });
});
