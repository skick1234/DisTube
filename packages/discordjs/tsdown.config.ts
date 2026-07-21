import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  outputOptions: { exports: "named" },
  deps: { neverBundle: ["distube", "discord.js", "@discordjs/voice"] },
});
