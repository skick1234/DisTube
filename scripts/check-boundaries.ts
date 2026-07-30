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
const privateExports = [
  "./utils/",
  "./playback/",
  "./queue/mailbox",
  "PluginRegistry",
  "Session",
  "Snapshot",
  "Filter",
  "VoicePlugin",
  "SourceCatalog",
  "OwnedPlaybackResource",
  "PlaybackAttempt",
  "disposeOnce",
] as const;

function assertPublicEntry(source: string, path: string): void {
  for (const privatePath of privateExports) {
    if (source.includes(privatePath)) throw new Error(`${path} exposes removed/private surface ${privatePath}`);
  }
}

assertPublicEntry(entry, "distube public entry");

for (const publicType of [
  "SourceOperationOptions",
  "PlaybackContext",
  "UrlPlaybackResource",
  "PlaybackPreparation",
  "PlaybackRequest",
]) {
  if (!entry.includes(publicType)) throw new Error(`distube public entry is missing playback contract ${publicType}`);
}

for (const adapterRoot of ["packages/discordjs/src", "packages/oceanic/src", "packages/eris/src"]) {
  for (const file of await files(adapterRoot)) {
    const source = await Bun.file(file).text();
    assertPlayerBoundary(source, file);
  }
}

function assertPlayerBoundary(source: string, path: string): void {
  if (/\bitem\.song\.url\b|\brequest\.song\b/u.test(source)) {
    throw new Error(`${path} reads canonical Song data at the Player boundary`);
  }
}

for (const [name, fixture, assertion] of [
  ["Song URL read", "player.play(item.song.url)", assertPlayerBoundary],
  ["private mailbox export", 'export { Mailbox } from "./queue/mailbox"', assertPublicEntry],
] as const) {
  let rejected = false;
  try {
    assertion(fixture, `negative fixture: ${name}`);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Boundary negative fixture passed unexpectedly: ${name}`);
}
