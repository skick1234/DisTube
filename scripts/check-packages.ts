import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { assertPreparedBuild, ensurePreparedBuild } from "./prepared-build";

const workspace = resolve(import.meta.dir, "..");
const packageDirectories = ["distube", "discordjs", "oceanic", "eris"] as const;
const adapterPackages = new Set(["@distube/discordjs", "@distube/oceanic", "@distube/eris"]);
const adapterReadmeRequirements = [
  "Node 22.12.0",
  "FFmpeg",
  "FFMPEG_PATH",
  "@discordjs/opus",
  "opusscript",
  "VOICE_FAILED",
];

interface PackedManifest {
  readonly engines?: { readonly node?: string };
}

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

async function packedManifest(archive: string): Promise<PackedManifest> {
  return JSON.parse(await run(["tar", "-xOf", archive, "package/package.json"], workspace)) as PackedManifest;
}

/** Returns the runtime-absent symbols marked type-only by a packed declaration entry point. */
export function packedTypeOnlyExports(declaration: string): readonly string[] {
  const names = new Set<string>();
  for (const statement of declaration.matchAll(
    /export\s+(type\s+)?\{([\s\S]*?)\}(?:\s+from\s+["'][^"']+["'])?\s*;/gu,
  )) {
    const statementIsTypeOnly = statement[1] !== undefined;
    for (const raw of statement[2].split(",")) {
      const member = raw.trim();
      if (!member || (!statementIsTypeOnly && !member.startsWith("type "))) continue;
      const name = member
        .replace(/^type\s+/u, "")
        .trim()
        .split(/\s+as\s+/u)
        .at(-1);
      if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)) names.add(name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

async function filesBelow(path: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(child)));
    else files.push(child);
  }
  return files.sort();
}

function privateReference(content: string): string | undefined {
  const normalized = content.replaceAll("\\", "/");
  if (normalized.includes("@distube/voice-core")) return "@distube/voice-core";
  if (/(?:^|["'\s/])(?:packages\/)?voice-core\/src(?:["'\s/]|$)/u.test(normalized)) {
    return "voice-core source path";
  }
  return undefined;
}

async function expectedArchiveEntries(packageRoot: string): Promise<ReadonlySet<string>> {
  // LICENSE is required, not merely permitted: npm renders a package without one as unlicensed no
  // matter what the manifest's `license` field claims. `missing` below turns its absence into a failure.
  const entries = new Set(["package/package.json", "package/README.md", "package/LICENSE"]);
  for (const path of await filesBelow(resolve(packageRoot, "dist"))) {
    entries.add(`package/${relative(packageRoot, path).replaceAll("\\", "/")}`);
  }
  return entries;
}

async function assertPackedArchive(manifestName: string, packageRoot: string, archive: string): Promise<void> {
  const manifest = await packedManifest(archive);
  if (privateReference(JSON.stringify(manifest))) {
    throw new Error(`${manifestName}: packed manifest leaks @distube/voice-core`);
  }

  const entries = (await run(["tar", "-tzf", archive], workspace))
    .split(/\r?\n/u)
    .filter(entry => entry.length > 0 && !entry.endsWith("/"));
  const expected = await expectedArchiveEntries(packageRoot);
  const unexpected = entries.filter(entry => !expected.has(entry));
  const missing = [...expected].filter(entry => !entries.includes(entry));
  if (unexpected.length > 0) throw new Error(`${manifestName}: unexpected packed entries: ${unexpected.join(", ")}`);
  if (missing.length > 0) throw new Error(`${manifestName}: missing packed entries: ${missing.join(", ")}`);

  for (const entry of entries) {
    const reference =
      privateReference(entry) ?? privateReference(await run(["tar", "-xOf", archive, entry], workspace));
    if (reference) throw new Error(`${manifestName}: packed archive entry ${entry} leaks ${reference}`);
  }
}

if (import.meta.main) {
  if (process.argv.includes("--prepared")) await assertPreparedBuild(workspace);
  else await ensurePreparedBuild(workspace);
  for (const declaration of ["index.d.mts"]) {
    const content = await readFile(resolve(workspace, "packages/distube/dist", declaration), "utf8");
    if (/\b(?:from\s+["']eris|import\(["']eris)/u.test(content)) {
      throw new Error(`distube: native Eris type leaked into ${declaration}`);
    }
  }
  const temporary = await mkdtemp(join(tmpdir(), "distube-v6-packages-"));
  try {
    const archives = new Map<string, string>();
    for (const directory of packageDirectories) {
      const root = resolve(workspace, "packages", directory);
      const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
        name: string;
        exports: Record<string, unknown>;
        engines?: { node?: string };
      };
      const packed = await run(["bun", "pm", "pack", "--destination", temporary, "--quiet", "--ignore-scripts"], root);
      const archive = resolve(temporary, basename(packed.split(/\r?\n/u).at(-1) ?? ""));
      if (!(await Bun.file(archive).exists())) throw new Error(`${manifest.name}: archive was not created`);
      archives.set(manifest.name, archive);
      const entries = await readdir(root);
      for (const residue of entries.filter(entry => entry.endsWith(".tgz") || entry === ".artifacts")) {
        throw new Error(`${manifest.name}: package residue ${residue}`);
      }
      if (!manifest.exports?.["."]) throw new Error(`${manifest.name}: missing root export`);
      if ((await packedManifest(archive)).engines?.node !== ">=22.12.0") {
        throw new Error(`${manifest.name}: packed archive must require Node >=22.12.0`);
      }
      await assertPackedArchive(manifest.name, root, archive);
    }

    const distubeArchive = archives.get("distube");
    if (!distubeArchive) throw new Error("distube: archive was not created");
    await run(["bun", "scripts/check-playback-contract.ts"], workspace, {
      ...process.env,
      DISTUBE_PLAYBACK_ARCHIVE: distubeArchive,
    });

    const smoke = resolve(temporary, "smoke");
    await mkdir(smoke, { recursive: true });
    await Bun.write(
      resolve(smoke, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: Object.fromEntries([...archives].map(([name, archive]) => [name, `file:${archive}`])),
      }),
    );
    for (const [name, archive] of archives) {
      const target = resolve(smoke, "node_modules", ...name.split("/"));
      await mkdir(target, { recursive: true });
      await run(["tar", "-xzf", archive, "--strip-components=1", "-C", target], workspace);
      if (adapterPackages.has(name)) {
        const readme = await readFile(resolve(target, "README.md"), "utf8");
        for (const requirement of adapterReadmeRequirements) {
          if (!readme.includes(requirement)) throw new Error(`${name}: README omits ${requirement}`);
        }
      }
    }
    await mkdir(resolve(smoke, "node_modules/@discordjs"), { recursive: true });
    for (const dependency of ["discord.js", "oceanic.js", "eris"]) {
      await symlink(resolve(workspace, "node_modules", dependency), resolve(smoke, "node_modules", dependency), "dir");
    }
    await symlink(
      resolve(workspace, "node_modules/@discordjs/voice"),
      resolve(smoke, "node_modules/@discordjs/voice"),
      "dir",
    );
    await symlink(resolve(workspace, "node_modules/typescript"), resolve(smoke, "node_modules/typescript"), "dir");
    const typeOnlyExports = packedTypeOnlyExports(
      await run(["tar", "-xOf", distubeArchive, "package/dist/index.d.mts"], workspace),
    );
    if (typeOnlyExports.length === 0) throw new Error("distube packed declaration has no type-only exports");
    await writeFile(
      resolve(smoke, "smoke.mjs"),
      `import * as core from "distube";
import { DiscordJSAdapter } from "@distube/discordjs";
import { OceanicAdapter } from "@distube/oceanic";
import { ErisAdapter } from "@distube/eris";

// The values the reshaped surface publishes, and the commands each published class carries.
const restored = ["DisTube", "DisTubeError", "Playlist", "Song"];
for (const name of Object.keys(core)) {
  if (!restored.includes(name)) throw new Error(\`unexpected runtime export \${name}\`);
}
const commands = {
  DisTube: ["play", "resolve", "getQueue", "on", "dispose"],
};

for (const name of restored) {
  if (!core[name]) throw new Error(\`missing public export \${name}\`);
}
for (const name of ${JSON.stringify(typeOnlyExports)}) {
  if (name in core) throw new Error(\`type-only export \${name} has a runtime value\`);
}
for (const [owner, members] of Object.entries(commands)) {
  for (const member of members) {
    if (typeof core[owner].prototype[member] !== "function") throw new Error(\`\${owner} is missing \${member}\`);
  }
}
for (const removed of ["createQueue", "destroyQueue"]) {
  if (removed in core.DisTube.prototype) throw new Error(\`DisTube still exposes removed \${removed}\`);
}
for (const Adapter of [DiscordJSAdapter, OceanicAdapter, ErisAdapter]) {
  if (typeof Adapter.prototype.createVoiceSession !== "function") throw new Error(\`\${Adapter.name} creates no VoiceSession\`);
  if ("createPlayer" in Adapter.prototype) throw new Error(\`\${Adapter.name} still exposes createPlayer\`);
}
`,
    );
    await run(["node", "smoke.mjs"], smoke);
    await writeFile(
      resolve(smoke, "adapter-surface.mjs"),
      `import * as discord from "@distube/discordjs";
import * as oceanic from "@distube/oceanic";
import * as eris from "@distube/eris";

const packages = [
  ["@distube/discordjs", discord, "DiscordJSAdapter", ["DiscordVoiceEngine", "DiscordVoicePlayer", "createDiscordJSAdapter"]],
  ["@distube/oceanic", oceanic, "OceanicAdapter", ["DiscordVoiceEngine", "DiscordVoicePlayer", "createOceanicAdapter"]],
  ["@distube/eris", eris, "ErisAdapter", ["ErisVoiceEngine", "ErisVoicePlayer", "ErisVoiceSession", "createErisAdapter"]],
];
for (const [name, api, adapter, forbidden] of packages) {
  if (typeof api[adapter] !== "function") throw new Error(name + " does not export " + adapter);
  for (const member of forbidden) if (member in api) throw new Error(name + " leaked " + member);
}
const adapters = [
  new discord.DiscordJSAdapter({ guilds: { cache: new Map() } }),
  new oceanic.OceanicAdapter({ guilds: new Map() }),
  new eris.ErisAdapter({}),
];
for (const adapter of adapters) {
  if (typeof adapter.engine.createPlayer !== "function" || typeof adapter.engine.resolvable !== "function") {
    throw new Error("adapter did not expose the Engine contract");
  }
}
`,
    );
    await run(["node", "adapter-surface.mjs"], smoke);
    await writeFile(
      resolve(smoke, "adapter-contract.ts"),
      `import type { Adapter, VoiceSession } from "distube/integrations";
import type { Client as DiscordClient } from "discord.js";
import type { Client as OceanicClient } from "oceanic.js";
import type { Client as ErisClient } from "eris";
import { DiscordJSAdapter } from "@distube/discordjs";
import { OceanicAdapter } from "@distube/oceanic";
import { ErisAdapter } from "@distube/eris";

declare const discord: DiscordClient;
declare const oceanic: OceanicClient;
declare const eris: ErisClient;
declare const session: VoiceSession;
const adapters: Adapter[] = [
  new DiscordJSAdapter(discord, { connectionTimeoutMs: 1, filters: { house: "volume=2" } }),
  new OceanicAdapter(oceanic, { connectionTimeoutMs: 1, filters: { house: "volume=2" } }),
  new ErisAdapter(eris, { connectionTimeoutMs: 1, filters: { house: "volume=2" } }),
];
async function releasePlayers(): Promise<void> {
  for (const adapter of adapters) await (await adapter.engine.createPlayer(session)).release();
}
// @ts-expect-error Player factories stay private to official adapter implementations.
new DiscordJSAdapter(discord, { playerFactory: async () => undefined });
// @ts-expect-error Preflight injection stays private to official adapter implementations.
new OceanicAdapter(oceanic, { preflight: async () => undefined });
// @ts-expect-error Player factories stay private to official adapter implementations.
new ErisAdapter(eris, { playerFactory: async () => undefined });
// @ts-expect-error Eris's concrete Player remains private.
import { ErisVoicePlayer } from "@distube/eris";
void [releasePlayers, ErisVoicePlayer];
`,
    );
    const compiler = resolve(smoke, "node_modules", "typescript", "bin", "tsc");
    await run(
      [
        process.execPath,
        compiler,
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--target",
        "ESNext",
        "adapter-contract.ts",
      ],
      smoke,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  process.stdout.write("Packed install smoke passed for all DisTube packages.\n");
}
