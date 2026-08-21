import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");
const archive = process.env.DISTUBE_PLAYBACK_ARCHIVE;
if (!archive) throw new Error("DISTUBE_PLAYBACK_ARCHIVE must name the packed distube archive");
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
  if (unpack.code !== 0) throw new Error(`Unable to unpack packed distube archive\n${unpack.output}`);
  await symlink(resolve(workspace, "node_modules", "typescript"), resolve(modules, "typescript"), "dir");

  const positive = resolve(temporary, "positive.ts");
  await Bun.write(
    positive,
    `import type { Adapter, DisTube, Engine, FilterEntry, GuildQueue, PlaybackContext, PlaybackPreparation, PlaybackRequest, PlayResult, Player, PlayerEvent, PluginContext, QueueFilters, RelatedContext, SourceOperationOptions, SourcePlugin, UrlPlaybackResource, Voice, VoiceManager, VoiceSession, VoiceTarget } from "distube";
import { Events, Filters, Playlist, QueueStatus, RepeatMode, Song } from "distube";
const song = new Song({ id: "song", title: "Song", url: "https://provider.example/song", duration: 1, source: "source", isLive: false });
const playlist = new Playlist({ id: "playlist", name: "Playlist", url: "https://provider.example/playlist", source: "source", songs: [song] });
const resource: UrlPlaybackResource = { kind: "url", url: "https://stream.example/audio", dispose() {} };
const source: SourcePlugin = { name: "source", initialize(_context: PluginContext) {}, dispose() {}, async search(_query: string, _options?: SourceOperationOptions) { return [song]; }, async resolve(_url: string, _options?: SourceOperationOptions) { return playlist; }, async preparePlayback(_song: Song, _context: PlaybackContext): Promise<PlaybackPreparation> { return { kind: "resource", resource }; }, async related(_song: Song, _context: RelatedContext) { return song; } };
const player: Player = { position: 0, async play(_request: PlaybackRequest) {}, async pause() {}, async resume() {}, async stopTrack() {}, async seek(_seconds: number) {}, async setVolume(_percent: number) {}, async setFilters(_entries: readonly FilterEntry[]) {}, async release() {}, subscribe(_listener: (event: PlayerEvent) => void) { return () => undefined; } };
declare const session: VoiceSession;
const engine: Engine = { async createPlayer(_session: VoiceSession) { return player; }, resolvable(name: string) { return name === Filters.Nightcore; } };
const adapter: Adapter = { async createVoiceSession(_target: VoiceTarget) { return session; }, engine };
declare const resultQueue: PlayResult["queue"];
declare const queue: GuildQueue;
declare const distubeVoices: DisTube["voices"];
declare const voices: VoiceManager;
const returnedQueue: GuildQueue = resultQueue;
const queueFilters: QueueFilters = queue.filters;
const publicVoices: VoiceManager = distubeVoices;
const managedVoice: Voice | undefined = voices.get("guild");
const vocabulary: string[] = [Events.QueueDeleted, RepeatMode.Queue, QueueStatus.Idle];
void [source, adapter, returnedQueue, queueFilters, publicVoices, managedVoice, vocabulary];
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
    [
      "missing-player-release",
      `import type { FilterEntry, PlaybackRequest, Player, PlayerEvent } from "distube"; const player: Player = { position: 0, async play(_request: PlaybackRequest) {}, async pause() {}, async resume() {}, async stopTrack() {}, async seek(_seconds: number) {}, async setVolume(_percent: number) {}, async setFilters(_entries: readonly FilterEntry[]) {}, subscribe(_listener: (event: PlayerEvent) => void) { return () => undefined; } }; void player;`,
    ],
    [
      "retired-adapter",
      `import type { Adapter, Engine, Player, VoiceSession } from "distube"; declare const engine: Engine; declare const session: VoiceSession; declare const player: Player; const adapter: Adapter = { async createPlayer(_binding: { queueId: string }) { return player; }, engine }; void [adapter, session];`,
    ],
    [
      "unowned-filter-payload",
      `import type { FilterEntry } from "distube"; const entry: FilterEntry = { name: "bassboost", render: () => "bass=g=5" }; void entry;`,
    ],
    [
      "guild-queue-constructor",
      `import { GuildQueue } from "distube"; new GuildQueue({ queueId: "queue", guildId: "guild" }, {} as never, {} as never, {} as never, {} as never);`,
    ],
    [
      "queue-filters-constructor",
      `import { QueueFilters } from "distube"; new QueueFilters({} as never, {} as never);`,
    ],
    ["voice-constructor", `import { Voice } from "distube"; new Voice({} as never, {} as never, {} as never);`],
    [
      "voice-manager-constructor",
      `import { VoiceManager } from "distube"; new VoiceManager({} as never, {} as never, {} as never);`,
    ],
    [
      "guild-queue-instanceof",
      `import { GuildQueue } from "distube"; declare const queue: object; queue instanceof GuildQueue;`,
    ],
    [
      "queue-filters-instanceof",
      `import { QueueFilters } from "distube"; declare const filters: object; filters instanceof QueueFilters;`,
    ],
    ["voice-instanceof", `import { Voice } from "distube"; declare const voice: object; voice instanceof Voice;`],
    [
      "voice-manager-instanceof",
      `import { VoiceManager } from "distube"; declare const manager: object; manager instanceof VoiceManager;`,
    ],
    [
      "facade-declaration-merge",
      `declare module "distube" {
  interface GuildQueue { destroy(): Promise<void>; }
  interface QueueFilters { releaseAll(): Promise<void>; }
  interface Voice { player(): Promise<unknown>; retire(player: never): void; release(): Promise<void>; }
  interface VoiceManager {
    borrow(target: { guildId: string; channelId: string }): Promise<unknown>;
    fence(): void;
    releaseAll(): Promise<readonly Error[]>;
  }
}
import type { GuildQueue, QueueFilters, Voice, VoiceManager } from "distube";
declare const queue: GuildQueue;
declare const filters: QueueFilters;
declare const voice: Voice;
declare const manager: VoiceManager;
queue.destroy(); filters.releaseAll(); voice.player(); voice.retire(undefined as never); voice.release(); manager.borrow({ guildId: "guild", channelId: "voice" }); manager.fence(); manager.releaseAll();`,
    ],
    [
      "guild-queue-channel-id",
      `import type { GuildQueue } from "distube"; declare const queue: GuildQueue; queue.channelId;`,
    ],
    [
      "guild-queue-destroy",
      `import type { GuildQueue } from "distube"; declare const queue: GuildQueue; queue.destroy();`,
    ],
    ["voice-released", `import type { Voice } from "distube"; declare const voice: Voice; voice.released;`],
    ["voice-player", `import type { Voice } from "distube"; declare const voice: Voice; voice.player();`],
    [
      "voice-retire",
      `import type { Player, Voice } from "distube"; declare const player: Player; declare const voice: Voice; voice.retire(player);`,
    ],
    ["voice-release", `import type { Voice } from "distube"; declare const voice: Voice; voice.release();`],
    [
      "voice-manager-borrow",
      `import type { VoiceManager } from "distube"; declare const manager: VoiceManager; manager.borrow({ guildId: "guild", channelId: "voice" });`,
    ],
    [
      "voice-manager-fence",
      `import type { VoiceManager } from "distube"; declare const manager: VoiceManager; manager.fence();`,
    ],
    [
      "voice-manager-release-all",
      `import type { VoiceManager } from "distube"; declare const manager: VoiceManager; manager.releaseAll();`,
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
      `const api = await import("distube");
if (!api.DisTube || !api.Song) throw new Error("missing runtime exports");
for (const name of ["GuildQueueImpl", "QueueFiltersImpl", "VoiceImpl", "VoiceManagerImpl", "GuildQueue", "QueueFilters", "Voice", "VoiceManager"]) {
  if (name in api) throw new Error("unexpected runtime export: " + name);
}
function assertFacade(value, forbidden, label) {
  if (!Object.isFrozen(value)) throw new Error(label + " is not frozen");
  if (Object.getPrototypeOf(value) !== Object.prototype || value.constructor !== Object) {
    throw new Error(label + " exposes an implementation prototype");
  }
  for (const name of forbidden) if (name in value) throw new Error(label + " leaks " + name);
}
const song = new api.Song({ id: "song", title: "Song", url: "https://provider.example/song", duration: 1, source: "source", isLive: false });
let channelId = "voice";
const listeners = new Set();
const session = {
  guildId: "guild",
  get channelId() { return channelId; },
  async join(next) { channelId = next; },
  async release() {},
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
const player = {
  position: 0,
  async play() {},
  async pause() {},
  async resume() {},
  async stopTrack() {},
  async seek() {},
  async setVolume() {},
  async setFilters() {},
  async release() {},
  subscribe() { return () => {}; },
};
const resource = { kind: "url", url: "https://stream.example/audio", dispose() {} };
const engine = { async createPlayer() { return player; }, resolvable() { return true; } };
const source = {
  name: "source",
  initialize() {},
  dispose() {},
  async search() { return [song]; },
  async resolve() { return song; },
  async preparePlayback() { return { kind: "resource", resource }; },
};
const client = new api.DisTube({ adapter: { async createVoiceSession() { return session; }, engine }, plugins: [source] });
const created = [];
client.on(api.Events.QueueCreated, event => created.push(event.queue));
const voices = client.voices;
assertFacade(voices, ["borrow", "fence", "releaseAll"], "VoiceManager");
const voice = await voices.join({ guildId: "guild", channelId: "voice" });
assertFacade(voice, ["player", "retire", "release", "released"], "Voice");
if (voices.get("guild") !== voice || [...voices][0] !== voice) throw new Error("Voice collections do not carry the facade");
const queue = (await client.play({ guildId: "guild", voiceChannelId: "voice" }, song)).queue;
if (client.getQueue("guild") !== queue || [...client.queues][0] !== queue) throw new Error("Queue collections do not carry the facade");
if (created.length !== 1 || created[0] !== queue) throw new Error("queue.created does not carry the facade");
assertFacade(queue, ["destroy", "player", "retire", "release"], "GuildQueue");
const filters = queue.filters;
assertFacade(filters, ["engine", "host", "releaseAll"], "QueueFilters");
if (queue.filters !== filters) throw new Error("GuildQueue.filters is not stable");
await queue.stop();
await client.shutdown();
`,
    ],
    temporary,
  );
  if (runtime.code !== 0) throw new Error(`Frozen runtime smoke failed\n${runtime.output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write("Packed playback contract accepted current fixtures and rejected retired declarations.\n");
