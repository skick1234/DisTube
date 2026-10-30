import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The package builds from core's sources, so its tests run against them too, never a stale build.
  resolve: { alias: { distube: fileURLToPath(new URL("../distube/src/index.ts", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    execArgv: ["--expose-gc"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // V8 coverage does not follow worker threads, so the worker's own lines would always read as unrun.
      exclude: ["src/worker.ts", "src/worker-input.ts"],
      thresholds: { branches: 80, functions: 85, lines: 90, statements: 85 },
    },
  },
});
