import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const privateReference = /@distube\/voice-core|(?:^|[\\/])voice-core[\\/]src(?:[\\/]|$)/u;

async function filesBelow(path: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(child)));
    else files.push(child);
  }
  return files;
}

function removeSourceMarkers(content: string): string {
  return content.replace(/^\s*\/\/#(?:end)?region.*\r?\n/gmu, "").replace(/^\s*\/\/# sourceMappingURL=.*\r?\n?/gmu, "");
}

const dist = resolve(process.cwd(), "dist");
for (const path of await filesBelow(dist)) {
  if (path.endsWith(".map")) {
    await rm(path);
    continue;
  }
  const content = await readFile(path, "utf8");
  const sanitized = removeSourceMarkers(content);
  if (privateReference.test(sanitized)) {
    throw new Error(`Private voice-core reference remains in ${path}`);
  }
  if (sanitized !== content) await writeFile(path, sanitized);
}
