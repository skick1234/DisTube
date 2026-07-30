import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/GuildQueue.ts",
        "src/QueueManager.ts",
        "src/errors.ts",
        "src/events.ts",
        "src/playback/**/*.ts",
        "src/queue/mailbox.ts",
        "src/utils/dispose.ts",
      ],
      thresholds: { branches: 70, functions: 80, lines: 80, statements: 80 },
    },
  },
});
