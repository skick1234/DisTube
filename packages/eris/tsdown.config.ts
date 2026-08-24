import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  // The private shared implementation lives outside this package, so declarations are generated
  // from a repository-rooted tsconfig that can see both trees.
  tsconfig: "../../tsconfig.build.json",
  format: ["esm"],
  target: "es2022",
  dts: true,
  // A map of bundled voice-core would ship that private tree's paths and sources, as it does for the
  // other adapters that bundle it.
  sourcemap: false,
  clean: true,
  outputOptions: { exports: "named" },
  deps: { neverBundle: ["distube", "eris"] },
});
