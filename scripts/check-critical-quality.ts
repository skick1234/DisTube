import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFile(resolve(root, path), "utf8");

const criticalModules = [
  "src/DisTube.ts",
  "src/GuildQueue.ts",
  "src/QueueManager.ts",
  "src/errors.ts",
  "src/events.ts",
  "src/playback/**/*.ts",
  "src/queue/**/*.ts",
  "src/utils/dispose.ts",
] as const;

const owningTests = [
  "packages/distube/tests/distube.test.ts",
  "packages/distube/tests/mailbox-model.test.ts",
  "packages/distube/tests/playback-orchestration.test.ts",
  "packages/distube/tests/playback-validation.test.ts",
  "packages/distube/tests/queue-state.test.ts",
  "packages/distube/tests/source-catalog.test.ts",
] as const;

const config = await read("packages/distube/vitest.config.ts");
for (const module of criticalModules) {
  if (!config.includes(`"${module}"`)) throw new Error(`Critical coverage scope excludes ${module}`);
}

for (const test of owningTests) {
  const source = await read(test);
  if (!source.trim()) throw new Error(`Critical test is empty: ${test}`);
}
process.stdout.write(`Critical quality inventory passed for ${criticalModules.length} module scopes.\n`);
