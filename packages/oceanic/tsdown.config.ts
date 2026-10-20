import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", "pipeline-worker": "../voice-core/src/pipeline-worker.ts" },
  // The private shared implementation lives outside this package, so declarations are generated
  // from a repository-rooted tsconfig that can see both trees.
  tsconfig: "../../tsconfig.build.json",
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: false,
  clean: true,
  outputOptions: { exports: "named" },
  deps: { neverBundle: ["distube", "oceanic.js", "@discordjs/voice"] },
});
