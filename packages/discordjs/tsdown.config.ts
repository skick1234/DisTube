import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", worker: "../voice-core/src/worker.ts" },
  // The private shared implementation lives outside this package, so declarations are generated
  // from a repository-rooted tsconfig that can see both trees.
  tsconfig: "../../tsconfig.build.json",
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: false,
  clean: true,
  outputOptions: { exports: "named" },
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  deps: { neverBundle: ["distube", "discord.js", "@discordjs/voice"] },
});
