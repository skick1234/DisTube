import { describe, expect, test } from "bun:test";
import { packedTypeOnlyExports } from "./check-packages";

describe("packed type-only export inventory", () => {
  test("derives runtime-absent names from declaration exports", () => {
    const declaration = `
      export type { OnlyType, Renamed as TypeAlias } from "./types";
      export { type Contract, RuntimeValue, type Legacy as CurrentName } from "./entry";
    `;

    expect(packedTypeOnlyExports(declaration)).toEqual(["Contract", "CurrentName", "OnlyType", "TypeAlias"]);
  });
});
