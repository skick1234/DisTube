import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function inspectRuntimeVersion(expected: string, observed: string, revision = observed): string[] {
  const errors = expected === observed ? [] : [`expected Bun ${expected}, observed ${observed}`];
  if (revision.includes("-canary")) {
    errors.push(`expected stable Bun ${expected}, observed canary revision ${revision}`);
  }
  return errors;
}

async function bunRevision(): Promise<string> {
  const child = Bun.spawn([process.execPath, "--revision"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const revision = stdout.trim();
  if (code !== 0 || !revision) throw new Error(`bun --revision failed\n${stderr}`);
  return revision;
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    readonly packageManager?: string;
  };
  const expected = manifest.packageManager?.replace(/^bun@/u, "");
  if (!expected) throw new Error("package.json must pin packageManager to bun@<version>");
  const revision = await bunRevision();
  const errors = inspectRuntimeVersion(expected, Bun.version, revision);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write(`Runtime verified: Bun ${Bun.version} (${revision}).\n`);
}

if (import.meta.main) await main();
