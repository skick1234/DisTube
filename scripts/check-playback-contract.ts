import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const archive = process.env.DISTUBE_PLAYBACK_ARCHIVE;
if (!archive) throw new Error("DISTUBE_PLAYBACK_ARCHIVE must name the frozen distube archive");
const absoluteArchive = resolve(archive);
if (!(await Bun.file(absoluteArchive).exists())) throw new Error("Frozen distube archive does not exist");

async function run(command: readonly string[], cwd: string): Promise<Readonly<{ code: number; output: string }>> {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return Object.freeze({ code, output: `${stdout}${stderr}` });
}

const temporary = await mkdtemp(join(tmpdir(), "distube-playback-contract-"));
try {
  const modules = resolve(temporary, "node_modules");
  const distube = resolve(modules, "distube");
  await mkdir(distube, { recursive: true });
  const unpack = await run(["tar", "-xzf", absoluteArchive, "--strip-components=1", "-C", distube], workspace);
  if (unpack.code !== 0) throw new Error(`Unable to unpack frozen distube archive\n${unpack.output}`);
  await symlink(resolve(workspace, "node_modules", "typescript"), resolve(modules, "typescript"), "dir");

  const positive = resolve(temporary, "positive.ts");
  await Bun.write(
    positive,
    `import type { PlaybackContext, PlaybackPreparation, PlaybackRequest, Player, PlayerEvent, PluginContext, SourceOperationOptions, SourcePlugin, UrlPlaybackResource } from "distube";
import { Song } from "distube";
const song = new Song({ id: "song", title: "Song", url: "https://provider.example/song", duration: 1, source: "source" });
const resource: UrlPlaybackResource = { kind: "url", url: "https://stream.example/audio", dispose() {} };
const source: SourcePlugin = { name: "source", initialize(_context: PluginContext) {}, dispose() {}, async search(_query: string, _options?: SourceOperationOptions) { return [song]; }, async resolve(_url: string, _options?: SourceOperationOptions) { return song; }, async preparePlayback(_song: Song, _context: PlaybackContext): Promise<PlaybackPreparation> { return { kind: "resource", resource }; } };
const player: Player = { async play(_request: PlaybackRequest) {}, async pause() {}, async resume() {}, async stop() {}, async seek(_seconds: number) {}, subscribe(_listener: (event: PlayerEvent) => void) { return () => undefined; } };
void [source, player];
`,
  );

  const compiler = resolve(modules, "typescript", "bin", "tsc");
  const compilerArgs = [
    compiler,
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ESNext",
    "--lib",
    "ESNext,DOM",
  ];
  const passed = await run([process.execPath, ...compilerArgs, positive], temporary);
  if (passed.code !== 0) throw new Error(`New playback contract fixture failed\n${passed.output}`);

  const negativeFixtures = new Map([
    [
      "retired-player",
      `import type { Player, QueueItem } from "distube"; declare const player: Player; declare const item: QueueItem; player.play(item);`,
    ],
    [
      "missing-preparation",
      `import type { SourcePlugin } from "distube"; const source: SourcePlugin = { name: "legacy", initialize() {}, dispose() {}, async search() { return []; }, async resolve() { return undefined; } }; void source;`,
    ],
    [
      "malformed-resource",
      `import type { UrlPlaybackResource } from "distube"; const resource: UrlPlaybackResource = { kind: "stream", url: "/relative" }; void resource;`,
    ],
  ]);
  for (const [name, source] of negativeFixtures) {
    const path = resolve(temporary, `${name}.ts`);
    await Bun.write(path, source);
    const rejected = await run([process.execPath, ...compilerArgs, path], temporary);
    if (rejected.code === 0) throw new Error(`Old or malformed playback fixture compiled unexpectedly: ${name}`);
  }

  const runtime = await run(
    [
      process.execPath,
      "--input-type=module",
      "-e",
      'import("distube").then(api => { if (!api.DisTube || !api.Song) throw new Error("missing runtime exports"); })',
    ],
    temporary,
  );
  if (runtime.code !== 0) throw new Error(`Frozen runtime smoke failed\n${runtime.output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write("Frozen playback contract accepted new fixtures and rejected retired declarations.\n");
