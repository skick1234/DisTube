import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", worker: "../voice-core/src/worker.ts" },
  tsconfig: "../../tsconfig.build.json",
  format: ["esm"],
  target: "es2022",
  dts: true,
  sourcemap: false,
  clean: true,
  outputOptions: { exports: "named" },
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  deps: { neverBundle: ["distube", "oceanic.js", "@discordjs/voice"] },
});
