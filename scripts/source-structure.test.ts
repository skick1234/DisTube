import { describe, expect, test } from "bun:test";
import { collectModuleReferences } from "./source-structure";

describe("structural source inspection", () => {
  test("collects static, type-only, multiline, dynamic, require, and re-export references", () => {
    const source = `
      import type { A } from "type-only";
      import {
        B,
      } from "multiline";
      export { C } from "re-export";
      const dynamic = import("dynamic");
      const commonjs = require("commonjs");
    `;
    expect(collectModuleReferences(source).map(reference => reference.specifier)).toEqual([
      "type-only",
      "multiline",
      "re-export",
      "dynamic",
      "commonjs",
    ]);
  });

  test("ignores import-shaped comments and strings", () => {
    const source = `
      // import "comment";
      const text = 'import("string")';
      /* export { Fake } from "block-comment"; */
    `;
    expect(collectModuleReferences(source)).toEqual([]);
  });
});
