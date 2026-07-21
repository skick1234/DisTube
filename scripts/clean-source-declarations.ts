import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

async function clean(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await clean(path);
    else if (entry.name.endsWith(".d.ts") || entry.name.endsWith(".d.ts.map")) await rm(path, { force: true });
  }
}

for (const packageName of ["distube", "discordjs", "oceanic", "eris"]) {
  await clean(join(import.meta.dir, "..", "packages", packageName, "src"));
}
