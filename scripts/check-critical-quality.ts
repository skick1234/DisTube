import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFile(resolve(root, path), "utf8");

const criticalModules = [
  "src/GuildQueue.ts",
  "src/QueueManager.ts",
  "src/errors.ts",
  "src/events.ts",
  "src/playback/**/*.ts",
  "src/queue/mailbox.ts",
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

let assertions = 0;
for (const test of owningTests) {
  const source = await read(test);
  const count = source.match(/\bexpect\s*\(/gu)?.length ?? 0;
  if (count === 0) throw new Error(`Critical test contains zero assertions: ${test}`);
  assertions += count;
}
if (assertions < 75)
  throw new Error(`Critical playback suite has only ${assertions} static assertions; expected at least 75`);

const orchestration = await read("packages/distube/tests/playback-orchestration.test.ts");
for (const behavior of [
  "out-of-order completion",
  "explicit fallback",
  "five ranked candidates",
  "late Player acknowledgement",
  "late resource once",
  "cleanup rejects",
]) {
  if (!orchestration.includes(behavior)) throw new Error(`Critical orchestration inventory is missing ${behavior}`);
}

process.stdout.write(`Critical quality inventory passed with ${assertions} static assertions.\n`);
