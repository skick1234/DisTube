import { readdir } from "node:fs/promises";
import { join } from "node:path";

const coreForbidden = [
  "discord.js",
  "oceanic.js",
  "eris",
  "@discordjs/voice",
  "@distube/discordjs",
  "@distube/oceanic",
  "@distube/eris",
  "youtube",
  "spotify",
  "soundcloud",
];
const globallyForbidden = ["@distube/plugin-sdk", "@distube/testkit", "@distube-internal/"];

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(entry => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
}

for (const root of ["packages/distube/src", "packages/discordjs/src", "packages/oceanic/src", "packages/eris/src"]) {
  for (const file of await files(root)) {
    const source = await Bun.file(file).text();
    for (const dependency of globallyForbidden) {
      if (source.includes(dependency)) throw new Error(`${file} references removed contract ${dependency}`);
    }
    if (root === "packages/distube/src") {
      for (const dependency of coreForbidden) {
        if (source.includes(`from "${dependency}`) || source.includes(`import("${dependency}`)) {
          throw new Error(`${file} imports forbidden core dependency ${dependency}`);
        }
      }
    }
  }
}

const entry = await Bun.file("packages/distube/src/index.ts").text();
for (const privatePath of ["./utils/", "PluginRegistry", "Session", "Snapshot", "Filter", "VoicePlugin"]) {
  if (entry.includes(privatePath))
    throw new Error(`distube public entry exposes removed/private surface ${privatePath}`);
}
