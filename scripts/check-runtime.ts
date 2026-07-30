import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function inspectRuntimeVersion(expected: string, observed: string): string[] {
  return expected === observed ? [] : [`expected Bun ${expected}, observed ${observed}`];
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    readonly packageManager?: string;
  };
  const expected = manifest.packageManager?.replace(/^bun@/u, "");
  if (!expected) throw new Error("package.json must pin packageManager to bun@<version>");
  const errors = inspectRuntimeVersion(expected, Bun.version);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write(`Runtime verified: Bun ${Bun.version}.\n`);
}

if (import.meta.main) await main();
