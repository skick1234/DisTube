import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { assertPreparedBuild } from "./prepared-build";

const workspace = resolve(import.meta.dir, "..");
const packageDirectories = new Map([
  ["distube", "distube"],
  ["@distube/discordjs", "discordjs"],
  ["@distube/oceanic", "oceanic"],
  ["@distube/eris", "eris"],
]);

async function run(command: readonly string[], cwd: string, env = process.env): Promise<string> {
  const child = Bun.spawn([...command], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed\n${stdout}${stderr}`);
  return stdout.trim();
}

async function pack(packageName: string, destination: string): Promise<string> {
  const directory = packageDirectories.get(packageName);
  if (!directory) throw new Error(`Unknown package ${packageName}`);
  const output = await run(
    ["bun", "pm", "pack", "--destination", destination, "--quiet", "--ignore-scripts"],
    resolve(workspace, "packages", directory),
  );
  return resolve(destination, basename(output.split(/\r?\n/u).at(-1) ?? ""));
}

async function assertSystemFfmpeg(): Promise<void> {
  const command = process.env.FFMPEG_PATH || "ffmpeg";
  try {
    await run([command, "-version"], workspace);
  } catch {
    throw new Error("Packed local playback requires FFmpeg on PATH or FFMPEG_PATH.");
  }
}

/** Pure-JavaScript implementations, so `--ignore-scripts` still leaves the consumer able to play. */
const OPUS_PACKAGE = "opusscript@^0.0.8";
const ENCRYPTION_PACKAGES = ["@noble/ciphers@^2.0.0", "tweetnacl@^1.0.3"];

interface OptionalPrerequisites {
  readonly opus: boolean;
  readonly encryption: boolean;
}

async function installConsumer(
  root: string,
  archives: ReadonlyMap<string, string>,
  optional: OptionalPrerequisites,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, "package.json"), '{"private":true,"type":"module"}\n');
  await run(
    [
      "npm",
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-save",
      "--package-lock=false",
      ...archives.values(),
      "@discordjs/voice@^0.19.2",
      "discord.js@^14.27.0",
      "oceanic.js@^1.14.0",
      "eris@^0.18.0",
      ...(optional.opus ? [OPUS_PACKAGE] : []),
      ...(optional.encryption ? ENCRYPTION_PACKAGES : []),
    ],
    root,
  );
  // A transitive copy would defeat the point of the negative case, so the absent group is removed after install.
  if (!optional.opus) {
    await rm(resolve(root, "node_modules", "@discordjs", "opus"), { recursive: true, force: true });
    await rm(resolve(root, "node_modules", "opusscript"), { recursive: true, force: true });
  }
  if (!optional.encryption) {
    for (const module of [
      "sodium-native",
      "libsodium-wrappers",
      "@stablelib/xchacha20poly1305",
      "@noble/ciphers",
      "tweetnacl",
    ]) {
      await rm(resolve(root, "node_modules", ...module.split("/")), { recursive: true, force: true });
    }
  }
  await writeVoiceTransport(resolve(root, "node_modules", "@discordjs", "voice"));
}

async function writeVoiceTransport(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  await writeFile(
    resolve(path, "package.json"),
    '{"name":"@discordjs/voice","private":true,"type":"module","exports":"./index.mjs"}\n',
  );
  await writeFile(
    resolve(path, "index.mjs"),
    `import { EventEmitter } from "node:events";

export const AudioPlayerStatus = { Idle: "idle", Playing: "playing", Paused: "paused", AutoPaused: "autopaused" };
export const VoiceConnectionStatus = { Ready: "ready", Destroyed: "destroyed" };
export const VoiceConnectionDisconnectReason = {
  WebSocketClose: "websocket-close",
  Manual: "manual",
  AdapterUnavailable: "adapter-unavailable",
};
export const NoSubscriberBehavior = { Pause: "pause" };
export const StreamType = { Raw: "raw" };
export const metrics = { pcmChunks: 0 };
const waiters = [];

export function recordPcm() {
  metrics.pcmChunks += 1;
  for (const resolve of waiters.splice(0)) resolve();
}

export function waitForPcm() {
  return new Promise(resolve => waiters.push(resolve));
}

function state(status, resource) {
  return resource === undefined ? { status } : { status, resource };
}

class Player extends EventEmitter {
  state = state(AudioPlayerStatus.Idle);

  play(resource) {
    const previous = this.state;
    this.state = state(AudioPlayerStatus.Playing, resource);
    this.emit("stateChange", previous, this.state);
    const onData = () => {
      resource.stream.off("data", onData);
      resource.stream.pause();
      recordPcm();
    };
    resource.stream.on("data", onData);
    resource.stream.once("error", error => this.emit("error", Object.assign(error, { resource })));
    resource.stream.resume();
  }

  pause() {
    const previous = this.state;
    this.state = state(AudioPlayerStatus.Paused, previous.resource);
    this.emit("stateChange", previous, this.state);
    return true;
  }

  unpause() {
    const previous = this.state;
    this.state = state(AudioPlayerStatus.Playing, previous.resource);
    this.emit("stateChange", previous, this.state);
    return true;
  }

  stop() {
    const previous = this.state;
    this.state = state(AudioPlayerStatus.Idle);
    this.emit("stateChange", previous, this.state);
    return true;
  }
}

export function createAudioPlayer() {
  return new Player();
}

export function createAudioResource(stream) {
  return { stream, playbackDuration: 0, volume: { setVolume() {} } };
}

export function entersState(value, status, timeout) {
  if (value.state.status === status) return Promise.resolve(value);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      value.off("stateChange", onStateChange);
      reject(new Error("state timeout"));
    }, timeout);
    const onStateChange = (_previous, next) => {
      if (next.status !== status) return;
      clearTimeout(timer);
      value.off("stateChange", onStateChange);
      resolve(value);
    };
    value.on("stateChange", onStateChange);
  });
}

class Connection extends EventEmitter {
  joinConfig;
  state = {
    status: VoiceConnectionStatus.Ready,
    networking: { state: { connectionOptions: { sessionId: "session", token: "token", endpoint: "voice.example" } } },
  };

  constructor(options) {
    super();
    this.joinConfig = { channelId: options.channelId };
  }

  subscribe() {
    return { unsubscribe() {} };
  }

  rejoin(options) {
    this.joinConfig = { channelId: options.channelId };
    return true;
  }

  destroy() {
    const previous = this.state;
    this.state = { status: VoiceConnectionStatus.Destroyed };
    this.emit("stateChange", previous, this.state);
  }
}

export function joinVoiceChannel(options) {
  return new Connection(options);
}
`,
  );
}

function consumerSmoke(): string {
  return `import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { DiscordJSAdapter } from "@distube/discordjs";
import { OceanicAdapter } from "@distube/oceanic";
import { ErisAdapter } from "@distube/eris";
import { metrics, recordPcm, waitForPcm } from "@discordjs/voice";

const guildId = "guild";
const channelId = "channel";
const audio = wav();
let requests = 0;
const server = createServer((_request, response) => {
  requests += 1;
  response.writeHead(200, { "content-type": "audio/wav", "content-length": audio.length });
  response.end(audio);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("local audio server has no port");
const url = "http://127.0.0.1:" + address.port + "/audio.wav";

try {
  await start(
    "discordjs",
    new DiscordJSAdapter({ guilds: { cache: new Map([[guildId, { voiceAdapterCreator: () => ({}) }]]) } }),
    url,
  );
  await start(
    "oceanic",
    new OceanicAdapter({ guilds: new Map([[guildId, { voiceAdapterCreator: () => ({}) }]]) }),
    url,
  );
  await start("eris", new ErisAdapter(erisClient()), url);
  if (requests < 3) throw new Error("local audio server did not receive every playback request");
  if (metrics.pcmChunks < 3) throw new Error("FFmpeg did not produce one PCM chunk for every adapter");
} finally {
  await new Promise(resolve => server.close(resolve));
}

async function start(itemId, adapter, url) {
  const session = await adapter.createVoiceSession({ guildId, channelId });
  const player = await adapter.engine.createPlayer(session);
  try {
    const pcm = withTimeout(waitForPcm(), itemId + " did not produce PCM");
    await player.play({ itemId, resource: { kind: "url", url, dispose() {} } });
    await pcm;
  } finally {
    await player.release();
    await session.release();
  }
}

function withTimeout(value, message) {
  return Promise.race([
    value,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 10_000)),
  ]);
}

function erisClient() {
  const connection = Object.assign(new EventEmitter(), {
    channelID: channelId,
    playing: false,
    paused: false,
    ready: true,
    reconnecting: false,
    current: undefined,
  });
  connection.play = stream => {
    connection.playing = true;
    connection.current = { playTime: 0 };
    const onData = () => {
      stream.off("data", onData);
      stream.pause();
      recordPcm();
    };
    stream.on("data", onData);
    stream.resume();
  };
  connection.stopPlaying = () => {
    connection.playing = false;
    connection.current = undefined;
  };
  connection.pause = () => {
    connection.paused = true;
  };
  connection.resume = () => {
    connection.paused = false;
  };
  connection.setVolume = () => undefined;

  const client = Object.assign(new EventEmitter(), {
    user: { id: "bot" },
    connection,
    channel: { join() {}, guild: { id: guildId } },
  });
  client.getChannel = () => client.channel;
  client.joinVoiceChannel = async nextChannel => {
    connection.channelID = nextChannel;
    return connection;
  };
  client.leaveVoiceChannel = () => undefined;
  return client;
}

function wav() {
  const samples = 48_000;
  const data = Buffer.alloc(samples * 4);
  const file = Buffer.alloc(44 + data.length);
  file.write("RIFF", 0);
  file.writeUInt32LE(36 + data.length, 4);
  file.write("WAVEfmt ", 8);
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(2, 22);
  file.writeUInt32LE(48_000, 24);
  file.writeUInt32LE(192_000, 28);
  file.writeUInt16LE(4, 32);
  file.writeUInt16LE(16, 34);
  file.write("data", 36);
  file.writeUInt32LE(data.length, 40);
  data.copy(file, 44);
  return file;
}
`;
}

function preflightSmoke(): string {
  return `import { EventEmitter } from "node:events";
import { ErrorCode } from "distube";
import { DiscordJSAdapter } from "@distube/discordjs";
import { OceanicAdapter } from "@distube/oceanic";
import { ErisAdapter } from "@distube/eris";

const kind = process.argv[2];
const capability = { ffmpeg: "FFmpeg", opus: "Opus", encryption: "encryption" }[kind];
if (!capability) throw new Error("unknown prerequisite kind " + kind);
const guildId = "guild";
const channelId = "channel";

const adapters = [
  new DiscordJSAdapter({ guilds: { cache: new Map([[guildId, { voiceAdapterCreator: () => ({}) }]]) } }),
  new OceanicAdapter({ guilds: new Map([[guildId, { voiceAdapterCreator: () => ({}) }]]) }),
  new ErisAdapter(erisClient()),
];
for (const adapter of adapters) await expectPrerequisiteFailure(adapter, capability);

async function expectPrerequisiteFailure(adapter, capability) {
  const session = await adapter.createVoiceSession({ guildId, channelId });
  const player = await adapter.engine.createPlayer(session);
  let failure;
  try {
    await player.play({
      itemId: "missing-" + capability,
      resource: { kind: "url", url: "https://stream.example/audio", dispose() {} },
    });
  } catch (error) {
    failure = error;
  } finally {
    await player.release();
    await session.release();
  }
  if (!failure || failure.code !== ErrorCode.VOICE_FAILED || !failure.message.includes(capability)) {
    throw new Error("expected VOICE_FAILED mentioning " + capability);
  }
}

function erisClient() {
  const connection = Object.assign(new EventEmitter(), {
    channelID: channelId,
    playing: false,
    paused: false,
    ready: true,
    reconnecting: false,
    current: undefined,
  });
  connection.play = () => {
    connection.playing = true;
    connection.current = { playTime: 0 };
  };
  connection.stopPlaying = () => {
    connection.playing = false;
    connection.current = undefined;
  };
  connection.pause = () => undefined;
  connection.resume = () => undefined;
  connection.setVolume = () => undefined;

  const client = Object.assign(new EventEmitter(), {
    user: { id: "bot" },
    connection,
    channel: { join() {}, guild: { id: guildId } },
  });
  client.getChannel = () => client.channel;
  client.joinVoiceChannel = async nextChannel => {
    connection.channelID = nextChannel;
    return connection;
  };
  client.leaveVoiceChannel = () => undefined;
  return client;
}
`;
}

await assertPreparedBuild(workspace);
await assertSystemFfmpeg();
const temporary = await mkdtemp(join(tmpdir(), "distube-local-playback-"));
try {
  const archives = new Map<string, string>();
  for (const packageName of packageDirectories.keys()) archives.set(packageName, await pack(packageName, temporary));

  const consumer = resolve(temporary, "consumer");
  await installConsumer(consumer, archives, { opus: true, encryption: true });
  await writeFile(resolve(consumer, "smoke.mjs"), consumerSmoke());
  await run(["node", "smoke.mjs"], consumer);

  await writeFile(resolve(consumer, "preflight.mjs"), preflightSmoke());
  await run(["node", "preflight.mjs", "ffmpeg"], consumer, {
    ...process.env,
    FFMPEG_PATH: resolve(temporary, "missing-ffmpeg"),
  });

  const ffmpegProbe = resolve(temporary, "ffmpeg-probe");
  await writeFile(ffmpegProbe, "#!/usr/bin/env node\nprocess.exit(0);\n");
  await chmod(ffmpegProbe, 0o755);

  // Each optional group gets its own consumer, so the probe reports the one thing that is actually absent.
  for (const [kind, optional] of [
    ["opus", { opus: false, encryption: true }],
    ["encryption", { opus: true, encryption: false }],
  ] as const) {
    const root = resolve(temporary, `without-${kind}`);
    await installConsumer(root, archives, optional);
    await writeFile(resolve(root, "preflight.mjs"), preflightSmoke());
    await run(["node", "preflight.mjs", kind], root, { ...process.env, FFMPEG_PATH: ffmpegProbe });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write("Packed local playback and prerequisite smoke passed for DiscordJS, Oceanic, and Eris.\n");
