import type { Options } from "tsup";

export const tsup: Options = {
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  format: "cjs",
  minify: false,
  keepNames: true,
  skipNodeModulesBundle: true,
  sourcemap: true,
  target: "es2021",
};
