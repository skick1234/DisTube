import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/index.ts"],
      thresholds: { branches: 70, functions: 80, lines: 85, statements: 80 },
    },
  },
});
