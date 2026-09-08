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
  // Without this the fixtures are CJS under NodeNext, and an ESM-only package has nothing to offer them.
  await Bun.write(
    resolve(temporary, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );

  const positive = resolve(temporary, "positive.ts");
  await Bun.write(
    positive,
    `import type { Adapter, Engine, FilterEntry, PlaybackContext, PlaybackPreparation, PlaybackRequest, Player, PlayerEvent, PluginContext, RelatedContext, SourceOperationOptions, SourcePlugin, UrlPlaybackResource, VoiceSession, VoiceTarget } from "distube/integrations";
import { DisTube, Playlist, Song, type DisTubeGuild, type DisTubeVoice, type PlayResult } from "distube";
const song = new Song({ id: "song", name: "Song", url: "https://provider.example/song", duration: 1, source: "source" });
const playlist = new Playlist({ id: "playlist", name: "Playlist", url: "https://provider.example/playlist", source: "source", songs: [song] });
const resource: UrlPlaybackResource = { kind: "url", url: "https://stream.example/audio", dispose() {} };
const source: SourcePlugin = { name: "source", initialize(_context: PluginContext) {}, dispose() {}, async search(_query: string, _options?: SourceOperationOptions) { return [song]; }, async resolve(_url: string, _options?: SourceOperationOptions) { return playlist; }, async preparePlayback(_song: Song, _context: PlaybackContext): Promise<PlaybackPreparation> { return { kind: "resource", resource }; }, async related(_song: Song, _context: RelatedContext) { return song; } };
const player: Player = { position: 0, async play(_request: PlaybackRequest) {}, async pause() {}, async resume() {}, async stopTrack() {}, async seek(_seconds: number) {}, async setVolume(_percent: number) {}, async setFilters(_entries: readonly FilterEntry[]) {}, async release() {}, subscribe(_listener: (event: PlayerEvent) => void) { return () => undefined; } };
declare const session: VoiceSession;
const engine: Engine = { accepts: new Set(["url" as const]), async createPlayer(_session: VoiceSession) { return player; }, resolvable(name: string) { return name === "nightcore"; } };
const adapter: Adapter = { async createVoiceSession(_target: VoiceTarget) { return session; }, engine };
const music = new DisTube<{ requestedBy: string }>({ adapter, sources: [source], engine });
const pending: Promise<PlayResult<{ requestedBy: string }>> = music.play({ id: "voice", guild: { id: "guild" } }, song, { metadata: { requestedBy: "user" } });
const queue: DisTubeGuild<{ requestedBy: string }> | undefined = music.getQueue("guild");
const voice: DisTubeVoice | undefined = music.voices.get("guild");
if (queue) { void queue.state.current?.metadata?.requestedBy; void queue.state.upcoming; void queue.position; void queue.remove("item"); void queue.move("item", "next"); }
if (voice) { void voice.setFilters(["nightcore"]); void voice.setRepeat("queue"); void voice.settings.volume; }
const unsubscribe: () => void = music.on("queue.created", event => { const same: DisTubeGuild<{ requestedBy: string }> = event.queue; void same; });
unsubscribe(); void pending; void music.dispose();
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
    ["root-author-contract", `import type { Adapter } from "distube"; declare const adapter: Adapter; void adapter;`],
    [
      "player-media",
      `import type { Player } from "distube/integrations"; import type { QueueItem } from "distube"; declare const player: Player; declare const item: QueueItem; player.play(item);`,
    ],
    [
      "missing-preparation",
      `import type { SourcePlugin } from "distube/integrations"; const source: SourcePlugin = { name: "bad", async search() { return []; }, async resolve() { return undefined; } }; void source;`,
    ],
    [
      "malformed-resource",
      `import type { UrlPlaybackResource } from "distube/integrations"; const resource: UrlPlaybackResource = { kind: "stream", url: "/relative" }; void resource;`,
    ],
    ["guild-constructor", `import { DisTubeGuild } from "distube"; new DisTubeGuild();`],
    ["voice-constructor", `import { DisTubeVoice } from "distube"; new DisTubeVoice();`],
    ["queue-item-constructor", `import { QueueItem } from "distube"; new QueueItem();`],
    [
      "queue-native-channel",
      `import type { DisTubeGuild } from "distube"; declare const queue: DisTubeGuild; queue.channelId;`,
    ],
    [
      "queue-settings",
      `import type { DisTubeGuild } from "distube"; declare const queue: DisTubeGuild; queue.setVolume(50);`,
    ],
    [
      "queue-retirement",
      `import type { DisTubeGuild } from "distube"; declare const queue: DisTubeGuild; queue.destroy();`,
    ],
    ["voice-player", `import type { DisTubeVoice } from "distube"; declare const voice: DisTubeVoice; voice.player();`],
    [
      "voice-release",
      `import type { DisTubeVoice } from "distube"; declare const voice: DisTubeVoice; voice.release();`,
    ],
    [
      "manager-borrow",
      `import type { DisTube } from "distube"; declare const music: DisTube; music.voices.borrow({ guildId: "g", channelId: "v" });`,
    ],
    [
      "queue-registry-mutation",
      `import type { DisTube } from "distube"; declare const music: DisTube; music.queues.delete("g");`,
    ],
    [
      "metadata-type",
      `import type { DisTube } from "distube"; declare const music: DisTube<{ requestedBy: string }>; music.play({id:"v",guildId:"g"}, "song", {metadata:{requestedBy: 12}});`,
    ],
    [
      "native-shape",
      `import type { DisTube } from "distube"; declare const music: DisTube; music.play({channelId:"v",guildId:"g"}, "song");`,
    ],
    [
      "provider-metadata",
      `import { Song } from "distube"; new Song({source:"s",id:"i",name:"n",url:"https://example.org",metadata:{}});`,
    ],
    [
      "mixed-plugins",
      `import type { Adapter } from "distube/integrations"; import { DisTube } from "distube"; declare const adapter: Adapter; new DisTube({adapter, plugins:[]});`,
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
for (const name of ["DisTubeGuild", "DisTubeVoice", "QueueItem", "VoiceManager", "ErrorCode", "Events", "Filters", "RepeatMode", "asDisTubeError"]) {
  if (name in api) throw new Error("unexpected runtime export: " + name);
}
function assertFacade(value, forbidden, label) {
  if (!Object.isFrozen(value)) throw new Error(label + " is not frozen");
  if (Object.getPrototypeOf(value) !== Object.prototype || value.constructor !== Object) {
    throw new Error(label + " exposes an implementation prototype");
  }
  for (const name of forbidden) if (name in value) throw new Error(label + " leaks " + name);
}
const song = new api.Song({ id: "song", name: "Song", url: "https://provider.example/song", duration: 1, source: "source" });
let channelId = "voice";
const listeners = new Set();
const session = {
  guildId: "guild",
  get channelId() { return channelId; },
  async join(next) { channelId = next; },
  async release() {},
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
let renderedFilters = [];
const player = {
  position: 0,
  async play() {},
  async pause() {},
  async resume() {},
  async stopTrack() {},
  async seek() {},
  async setVolume() {},
  async setFilters(entries) { renderedFilters = [...entries]; },
  async release() {},
  subscribe() { return () => {}; },
};
const resource = { kind: "url", url: "https://stream.example/audio", dispose() {} };
const engine = { accepts: new Set(["url"]), async createPlayer() { return player; }, resolvable() { return true; } };
const source = {
  name: "source",
  initialize() {},
  dispose() {},
  async search() { return [song]; },
  async resolve() { return song; },
  async preparePlayback() { return { kind: "resource", resource }; },
};
const client = new api.DisTube({ adapter: { async createVoiceSession() { return session; }, engine }, sources: [source] });
const created = [];
client.on("queue.created", event => created.push(event.queue));
const voices = client.voices;
assertFacade(voices, ["borrow", "fence", "releaseAll"], "VoiceManager");
const voice = await voices.join({ guildId: "guild", id: "voice" });
assertFacade(voice, ["player", "retire", "release", "released"], "Voice");
if (voices.get("guild") !== voice || [...voices][0] !== voice) throw new Error("Voice collections do not carry the facade");
const queue = (await client.play({ guildId: "guild", id: "voice" }, song)).queue;
if (client.getQueue("guild") !== queue || [...client.queues][0] !== queue) throw new Error("Queue collections do not carry the facade");
if (created.length !== 1 || created[0] !== queue) throw new Error("queue.created does not carry the facade");
assertFacade(queue, ["destroy", "player", "retire", "release", "volume", "setVolume", "repeatMode", "setRepeatMode", "autoplay", "setAutoplay", "filters", "previousSongs"], "DisTubeGuild");
await voice.setVolume(60);
await voice.setRepeat("queue");
await voice.setAutoplay(true);
await voice.setFilters(["nightcore"]);
if (renderedFilters[0]?.name !== "nightcore") throw new Error("filters not rendered");
if (voice.settings.filters[0] !== "nightcore") throw new Error("selected filters missing");
await queue.stop();
if (voice.settings.filters.length || renderedFilters.length) throw new Error("queue stop retained selected or rendered filters");
if (voice.settings.volume !== 60 || voice.settings.repeat !== "queue" || !voice.settings.autoplay) throw new Error("queue stop discarded voice settings");
await client.dispose();
`,
    ],
    temporary,
  );
  if (runtime.code !== 0) throw new Error(`Frozen runtime smoke failed\n${runtime.output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write("Packed playback contract accepted current fixtures and rejected retired declarations.\n");
