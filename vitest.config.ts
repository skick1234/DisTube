import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    exclude: ["**/node_modules", "**/dist", ".idea", ".git"],
    coverage: {
      enabled: true,
      all: true,
      reporter: ["text", "lcov", "cobertura"],
      provider: "v8",
      include: ["src"],
      exclude: [
        "**/*.{interface,type,d}.ts",
        "**/{interfaces,types?}/*.ts",
        "**/{interface,type}.ts",
        "**/index.{js,ts}",
      ],
    },
  },
});
