import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";

export async function bundle(packageDir: URL): Promise<Map<string, string>> {
  const outDir = await mkdtemp(join(tmpdir(), "distube-adapter-build-"));
  try {
    await build({ cwd: fileURLToPath(packageDir), outDir, logLevel: "silent" });
    const files = await readdir(outDir);
    return new Map(
      await Promise.all(files.map(async file => [file, await readFile(join(outDir, file), "utf8")] as const)),
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
