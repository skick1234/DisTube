import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

for (const directory of ["distube", "discordjs", "oceanic", "eris"]) {
  const root = resolve(import.meta.dir, "..", "packages", directory);
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { name: string };
  const declaration = resolve(root, "dist", "index.d.mts");
  if (!(await Bun.file(declaration).exists())) throw new Error(`${manifest.name}: missing declaration ${declaration}`);
  const source = await Bun.file(declaration).text();
  for (const removed of ["PluginClass", "PluginDefinition", "PluginRegistry", "Snapshot", "VoicePlugin", "Testkit"]) {
    if (source.includes(removed)) throw new Error(`${manifest.name}: declaration leaks removed ${removed}`);
  }
  process.stdout.write(`${manifest.name}: ${Bun.hash(source).toString(16)}\n`);
}
