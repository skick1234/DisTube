import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { type CompatibilityCase, inspectPeerCoverage, selectPeerBoundaries } from "./peer-boundaries";
import { assertPreparedBuild, ensurePreparedBuild } from "./prepared-build";

type CompatibilityMatrix = Readonly<Record<string, readonly CompatibilityCase[]>>;

const workspace = resolve(import.meta.dir, "..");
const packageDirectories = new Map([
  ["distube", "distube"],
  ["@distube/discordjs", "discordjs"],
  ["@distube/oceanic", "oceanic"],
  ["@distube/eris", "eris"],
]);

interface AdapterSurface {
  readonly className: string;
  readonly client: string;
  readonly clientType: string;
  readonly factoryAlias: string;
}

const adapterSurfaces: Readonly<Record<string, AdapterSurface>> = {
  "@distube/discordjs": {
    className: "DiscordJSAdapter",
    client: "{ guilds: { cache: new Map() } }",
    clientType: 'import("discord.js").Client',
    factoryAlias: "createDiscordJSAdapter",
  },
  "@distube/oceanic": {
    className: "OceanicAdapter",
    client: "{ guilds: new Map() }",
    clientType: 'import("oceanic.js").Client',
    factoryAlias: "createOceanicAdapter",
  },
  "@distube/eris": {
    className: "ErisAdapter",
    client: "{}",
    clientType: 'import("eris").Client',
    factoryAlias: "createErisAdapter",
  },
};

async function publishedVersions(packageName: string): Promise<string[]> {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
  if (!response.ok) throw new Error(`${packageName}: registry returned ${response.status}`);
  const metadata = (await response.json()) as { versions?: Readonly<Record<string, unknown>> };
  return Object.keys(metadata.versions ?? {});
}

async function assertPeerRangesExercised(adapterName: string, cases: readonly CompatibilityCase[]): Promise<void> {
  const directory = packageDirectories.get(adapterName);
  if (!directory) throw new Error(`Unknown package ${adapterName}`);
  const manifest = JSON.parse(await readFile(resolve(workspace, "packages", directory, "package.json"), "utf8")) as {
    peerDependencies?: Readonly<Record<string, string>>;
  };
  // `distube` is supplied by the packed archive under test, not by a matrix pin.
  const peerRanges = Object.fromEntries(
    Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => name !== "distube"),
  );
  const published = new Map<string, string[]>();
  for (const peerName of Object.keys(peerRanges)) published.set(peerName, await publishedVersions(peerName));
  const errors = inspectPeerCoverage(adapterName, peerRanges, cases, (peerName, range) =>
    selectPeerBoundaries(published.get(peerName) ?? [], range),
  );
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

async function run(command: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
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

function adapterSurface(adapterName: string): AdapterSurface {
  const surface = adapterSurfaces[adapterName];
  if (!surface) throw new Error(`Missing packed surface contract for ${adapterName}`);
  return surface;
}

function runtimeSmoke(adapterName: string, surface: AdapterSurface): string {
  return `import * as api from ${JSON.stringify(adapterName)};
const exports = Object.keys(api).sort();
const expected = [${JSON.stringify(surface.className)}];
if (JSON.stringify(exports) !== JSON.stringify(expected)) {
  throw new Error("unexpected public exports: " + exports.join(", "));
}
const Adapter = api[${JSON.stringify(surface.className)}];
if (typeof Adapter !== "function") throw new Error("missing public adapter constructor");
const adapter = new Adapter(${surface.client});
if (typeof adapter.createVoiceSession !== "function") throw new Error("missing createVoiceSession");
if (typeof adapter.engine?.createPlayer !== "function" || typeof adapter.engine?.resolvable !== "function") {
  throw new Error("missing Engine contract");
}
try {
  await import("@distube/voice-core");
  throw new Error("private @distube/voice-core resolved from a consumer");
} catch (error) {
  if (error?.message === "private @distube/voice-core resolved from a consumer") throw error;
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
`;
}

function declarationSmoke(adapterName: string, surface: AdapterSurface): string {
  return `import type { Adapter, VoiceSession } from "distube";
import { ${surface.className} } from ${JSON.stringify(adapterName)};
// @ts-expect-error Legacy adapter factory aliases remain removed.
import { ${surface.factoryAlias} } from ${JSON.stringify(adapterName)};

declare const client: ${surface.clientType};
declare const session: VoiceSession;
const adapter: Adapter = new ${surface.className}(client, { connectionTimeoutMs: 1, filters: { house: "volume=2" } });
async function createAndRelease(): Promise<void> {
  await (await adapter.engine.createPlayer(session)).release();
}
// @ts-expect-error Test seams must not enter the public Adapter options.
new ${surface.className}(client, { playerFactory: async () => undefined });
// @ts-expect-error Test seams must not enter the public Adapter options.
new ${surface.className}(client, { preflight: async () => undefined });
void [createAndRelease, ${surface.factoryAlias}];
`;
}

const matrix = JSON.parse(await readFile(resolve(workspace, "adapter-compatibility.json"), "utf8")) as
  | CompatibilityMatrix
  | undefined;
if (!matrix || Object.keys(matrix).length === 0) throw new Error("Adapter compatibility matrix is empty");

if (process.argv.includes("--prepared")) await assertPreparedBuild(workspace);
else await ensurePreparedBuild(workspace);
await run(["bun", "scripts/clean-source-declarations.ts"], workspace);
const temporary = await mkdtemp(join(tmpdir(), "distube-adapter-compatibility-"));
try {
  const coreArchive = await pack("distube", temporary);
  for (const [adapterName, cases] of Object.entries(matrix)) {
    if (cases.length < 2) throw new Error(`${adapterName}: expected lower and latest compatibility cases`);
    await assertPeerRangesExercised(adapterName, cases);
    const adapterArchive = await pack(adapterName, temporary);
    for (const testCase of cases) {
      const testRoot = resolve(temporary, `${packageDirectories.get(adapterName)}-${testCase.name}`);
      await mkdir(testRoot, { recursive: true });
      await writeFile(
        resolve(testRoot, "package.json"),
        `${JSON.stringify(
          {
            private: true,
            type: "module",
            dependencies: {
              distube: `file:${coreArchive}`,
              [adapterName]: `file:${adapterArchive}`,
              ...testCase.dependencies,
            },
            devDependencies: { typescript: "^7.0.2" },
          },
          null,
          2,
        )}\n`,
      );
      await run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"], testRoot);
      const installed = JSON.parse(
        await readFile(resolve(testRoot, "node_modules", ...adapterName.split("/"), "package.json"), "utf8"),
      ) as { engines?: { node?: string } };
      if (installed.engines?.node !== ">=22.12.0") throw new Error(`${adapterName}: Node engine must be >=22.12.0`);
      const typescript = resolve(testRoot, "node_modules", "typescript");
      if (!(await Bun.file(resolve(typescript, "package.json")).exists())) {
        throw new Error(`${adapterName}: consumer install did not provide TypeScript`);
      }
      const surface = adapterSurface(adapterName);
      await writeFile(resolve(testRoot, "smoke.mjs"), runtimeSmoke(adapterName, surface));
      await run(["node", "smoke.mjs"], testRoot);
      await writeFile(resolve(testRoot, "adapter-contract.ts"), declarationSmoke(adapterName, surface));
      const compiler = resolve(typescript, "bin", "tsc");
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
        testRoot,
      );
      process.stdout.write(`${adapterName} ${testCase.name}: compatible\n`);
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
