import { defineConfig } from "tsdown";

const shared = {
  tsconfig: "../../tsconfig.build.json",
  target: "es2022",
  sourcemap: false,
  outputOptions: { exports: "named" },
  inputOptions: { experimental: { attachDebugInfo: "none" } },
  deps: { neverBundle: ["distube", "discord.js", "@discordjs/voice"] },
} as const;

const declarationsOnly = {
  name: "declarations-only",
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const file of Object.keys(bundle)) if (file.endsWith(".cjs")) delete bundle[file];
  },
};

export default defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts", worker: "../voice-core/src/worker.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
  },
  {
    ...shared,
    entry: { index: "src/index.ts" },
    format: ["cjs"],
    dts: true,
    clean: false,
    plugins: [declarationsOnly],
  },
]);
