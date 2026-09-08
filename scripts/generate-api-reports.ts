import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertPreparedBuild, ensurePreparedBuild } from "./prepared-build";

const workspace = resolve(import.meta.dirname, "..");
if (process.argv.includes("--prepared")) await assertPreparedBuild(workspace);
else await ensurePreparedBuild(workspace);

for (const directory of ["distube", "discordjs", "oceanic", "eris"]) {
  const root = resolve(import.meta.dir, "..", "packages", directory);
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { name: string };
  for (const entry of directory === "distube" ? ["index", "integrations"] : ["index"]) {
    const declaration = resolve(root, "dist", `${entry}.d.mts`);
    if (!(await Bun.file(declaration).exists()))
      throw new Error(`${manifest.name}: missing declaration ${declaration}`);
    const source = await Bun.file(declaration).text();
    for (const removed of [
      "PluginClass",
      "PluginDefinition",
      "PluginRegistry",
      "Snapshot",
      "VoicePlugin",
      "Testkit",
      "createQueue",
      "CreateQueueOptions",
      "destroyQueue",
      "QueueBinding",
      "StreamLease",
    ]) {
      if (source.includes(removed)) throw new Error(`${manifest.name}: declaration leaks removed ${removed}`);
    }
    process.stdout.write(`${manifest.name}/${entry}: ${Bun.hash(source).toString(16)}\n`);
  }
}
