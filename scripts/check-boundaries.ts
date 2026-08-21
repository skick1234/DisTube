import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { collectExportedNames, collectModuleReferences } from "./source-structure";

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

/** Vocabulary the reshaped architecture retired; canonical replacements are named in the messages. */
const retiredTerms: readonly (readonly [RegExp, string])[] = [
  [/\bPluginClass\b|\bPluginDefinition\b/u, "Plugin"],
  [/\bSessionRegistry\b|\bGuildSession\b|\bSession ?Coordinator\b/u, "Voice and VoiceSession"],
  [/\bQueueAggregate\b|\bVoiceRuntime\b|\bPlaybackRuntime\b|\bFilterRuntime\b/u, "GuildQueue, Voice, and Engine"],
  [/\bEvent Journal\b|\bsnapshot\b/iu, "the live queue reference carried by every event"],
  [/\bStreamLease\b/u, "PlaybackPreparation and PlaybackResource"],
  [/\bidle queue\b/iu, "delete-on-exhaustion language"],
  [/\bcreateQueue\b|\bdestroyQueue\b|\bqueue\.destroyed\b/u, "distube.play, queue.stop(), and queue.deleted"],
  [/\btestkit\b|\bplugin-sdk\b/iu, "the published packages"],
];

for (const root of [
  "packages/distube/src",
  "packages/discordjs/src",
  "packages/oceanic/src",
  "packages/eris/src",
  "packages/voice-core/src",
]) {
  for (const file of await files(root)) {
    const source = await Bun.file(file).text();
    const references = collectModuleReferences(source, file);
    for (const dependency of globallyForbidden) {
      if (references.some(reference => reference.specifier.startsWith(dependency))) {
        throw new Error(`${file} imports removed contract ${dependency}`);
      }
    }
    assertTerminology(source, file);
    if (root === "packages/distube/src") {
      for (const dependency of coreForbidden) {
        if (
          references.some(
            reference => reference.specifier === dependency || reference.specifier.startsWith(`${dependency}/`),
          )
        ) {
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
  // `VoiceSession` is public vocabulary; only the rejected session terms stay banned.
  "SessionRegistry",
  "GuildSession",
  "SessionCoordinator",
  "Snapshot",
  // `Filters` is public vocabulary; only the rejected runtime term stays banned.
  "FilterRuntime",
  "VoicePlugin",
  "SourceCatalog",
  "OwnedPlaybackResource",
  "PlaybackAttempt",
  "disposeOnce",
] as const;

function assertPublicEntry(source: string, path: string): void {
  const references = collectModuleReferences(source, path);
  const names = collectExportedNames(source, path);
  for (const privatePath of privateExports) {
    if (
      references.some(reference => reference.specifier.includes(privatePath)) ||
      [...names].some(name => name.includes(privatePath))
    ) {
      throw new Error(`${path} exposes removed/private surface ${privatePath}`);
    }
  }
}

assertPublicEntry(entry, "distube public entry");

/**
 * The whole reshaped `distube` surface, in export order.
 *
 * The allowlist is exact: a restored symbol that goes missing and a private one that leaks both fail
 * here, so removed surface (`createQueue`, `destroyQueue`, `QueueBinding`) cannot come back unnoticed.
 */
const publicSurface: readonly string[] = [
  "Adapter",
  "Diagnostic",
  "DiagnosticSeverity",
  "EncodedPlaybackResource",
  "Engine",
  "FilterDefinition",
  "FilterDefinitions",
  "FilterEntry",
  "PlaybackContext",
  "PlaybackPreparation",
  "PlaybackRequest",
  "PlaybackResource",
  "Player",
  "PlayerEvent",
  "Plugin",
  "PluginContext",
  "PluginDiagnostic",
  "RelatedContext",
  "ResolvableInput",
  "SourceOperationOptions",
  "SourcePlugin",
  "UrlPlaybackResource",
  "VoiceGatewayData",
  "VoiceSession",
  "VoiceSessionEvent",
  "VoiceTarget",
  "DisTube",
  "DisTubeOptions",
  "PlayOptions",
  "PlayResult",
  "PlayTarget",
  "Events",
  "Filters",
  "QueueStatus",
  "RepeatMode",
  "asDisTubeError",
  "DisTubeError",
  "ErrorCode",
  "BaseQueueEvent",
  "DisTubeEventListener",
  "DisTubeEventMap",
  "DisTubeEventName",
  "VoiceDisconnectReason",
  "GuildQueue",
  "JumpOptions",
  "Playlist",
  "PlaylistData",
  "QueueItem",
  "QueueItemData",
  "Song",
  "SongData",
  "SongUploader",
  "QueueCollection",
  "QueueFilters",
  "EnqueueOptions",
  "JumpTarget",
  "QueueState",
  "RemoveTarget",
  "Voice",
  "VoiceCollection",
  "VoiceManager",
];

function assertPublicSurface(source: string, path: string): void {
  const names = collectExportedNames(source, path);
  for (const expected of publicSurface) {
    if (!names.has(expected)) throw new Error(`${path} is missing public symbol ${expected}`);
  }
  for (const name of names) {
    if (!publicSurface.includes(name)) throw new Error(`${path} exports unlisted symbol ${name}`);
  }
}

assertPublicSurface(entry, "distube public entry");

for (const adapterRoot of [
  "packages/discordjs/src",
  "packages/oceanic/src",
  "packages/eris/src",
  "packages/voice-core/src",
]) {
  for (const file of await files(adapterRoot)) {
    const source = await Bun.file(file).text();
    assertPlayerBoundary(source, file);
  }
}

function assertPlayerBoundary(source: string, path: string): void {
  // A Player plays `request.resource` and nothing else: canonical media and queue state stay in core.
  if (/\bitem\.song\b|\brequest\.song\b|\bsong\.url\b/u.test(source)) {
    throw new Error(`${path} reads canonical Song data at the Player boundary`);
  }
  if (/\bQueueState\b|\bqueue\.(?:deleted|finished|item)\b/u.test(source)) {
    throw new Error(`${path} touches queue state or queue events an engine does not own`);
  }
}

function assertTerminology(source: string, path: string): void {
  for (const [retired, canonical] of retiredTerms) {
    const match = retired.exec(source);
    if (match) throw new Error(`${path} uses retired term ${match[0]}; use ${canonical}`);
  }
}

for (const [name, fixture, assertion] of [
  ["Song URL read", "player.play(item.song.url)", assertPlayerBoundary],
  ["engine writes queue state", "const next: QueueState = current;", assertPlayerBoundary],
  ["private mailbox export", 'export { Mailbox } from "./queue/mailbox"', assertPublicEntry],
  ["missing restored symbol", 'export { DisTube } from "./DisTube"', assertPublicSurface],
  ["unlisted export", `${entry}\nexport const debugInternals = true;`, assertPublicSurface],
  ["retired term", "// the idle queue is reused", assertTerminology],
] as const) {
  let rejected = false;
  try {
    assertion(fixture, `negative fixture: ${name}`);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Boundary negative fixture passed unexpectedly: ${name}`);
}
