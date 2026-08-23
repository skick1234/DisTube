import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { inspectRuntimeVersion } from "./check-runtime";

const packageDirectories = ["distube", "discordjs", "oceanic", "eris"] as const;
const ignoredDirectories = new Set(["coverage", "dist", "node_modules"]);
const requiredOutputFiles = ["index.mjs", "index.d.mts"] as const;

export interface PreparedBuildStamp {
  readonly schemaVersion: 2;
  readonly configuredBunVersion: string;
  readonly bunVersion: string;
  readonly bunRevision: string;
  readonly inputFingerprint: string;
  readonly outputs: Readonly<Record<string, string>>;
}

async function filesBelow(path: string, excludeIgnoredDirectories = true): Promise<string[]> {
  const entry = await stat(path);
  if (entry.isFile()) return [path];
  const files: string[] = [];
  for (const child of await readdir(path, { withFileTypes: true })) {
    if (child.isDirectory() && excludeIgnoredDirectories && ignoredDirectories.has(child.name)) continue;
    files.push(...(await filesBelow(resolve(path, child.name), excludeIgnoredDirectories)));
  }
  return files.sort();
}

async function hashFiles(root: string, paths: readonly string[]): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  for (const path of [...paths].sort()) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await Bun.file(path).arrayBuffer());
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function expectedBunVersion(root: string): Promise<string> {
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    readonly packageManager?: string;
  };
  const version = manifest.packageManager?.replace(/^bun@/u, "");
  if (!version) throw new Error("package.json must pin packageManager to bun@<version>");
  return version;
}

async function bunRevision(): Promise<string> {
  const child = Bun.spawn([process.execPath, "--revision"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const revision = stdout.trim();
  if (code !== 0 || !revision) throw new Error(`bun --revision failed\n${stderr}`);
  return revision;
}

async function checkedBunRuntime(
  expected: string,
): Promise<{ readonly bunVersion: string; readonly bunRevision: string }> {
  const bunRevisionValue = await bunRevision();
  const errors = inspectRuntimeVersion(expected, Bun.version, bunRevisionValue);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return { bunVersion: Bun.version, bunRevision: bunRevisionValue };
}

async function buildInputFiles(root: string): Promise<string[]> {
  const paths = [
    resolve(root, "package.json"),
    resolve(root, "bun.lock"),
    resolve(root, "tsconfig.json"),
    resolve(root, "tsconfig.build.json"),
    resolve(root, "scripts/clean-source-declarations.ts"),
    resolve(root, "scripts/sanitize-adapter-output.ts"),
  ];
  for (const directory of packageDirectories) {
    const packageRoot = resolve(root, "packages", directory);
    paths.push(
      resolve(packageRoot, "package.json"),
      resolve(packageRoot, "tsconfig.json"),
      resolve(packageRoot, "tsdown.config.ts"),
      ...(await filesBelow(resolve(packageRoot, "src"))),
    );
  }
  const voiceCore = resolve(root, "packages/voice-core");
  paths.push(
    resolve(voiceCore, "package.json"),
    resolve(voiceCore, "tsconfig.json"),
    ...(await filesBelow(resolve(voiceCore, "src"))),
  );
  return paths;
}

export async function preparedBuildInputFingerprint(root: string): Promise<string> {
  return hashFiles(root, await buildInputFiles(root));
}

function requiredBuildOutputPaths(root: string): string[] {
  return packageDirectories.flatMap(directory => {
    const dist = resolve(root, "packages", directory, "dist");
    return requiredOutputFiles.map(file => resolve(dist, file));
  });
}

async function buildOutputPaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const directory of packageDirectories) {
    paths.push(...(await filesBelow(resolve(root, "packages", directory, "dist"), false)));
  }
  return paths;
}

export async function preparedBuildOutputFingerprints(root: string): Promise<Readonly<Record<string, string>>> {
  const paths = await buildOutputPaths(root);
  const available = new Set(paths);
  const missing = requiredBuildOutputPaths(root).filter(path => !available.has(path));
  if (missing.length > 0) {
    throw new Error(
      `prepared build is missing required outputs: ${missing.map(path => relative(root, path)).join(", ")}`,
    );
  }
  const entries = await Promise.all(
    paths.map(async path => [relative(root, path).replaceAll("\\", "/"), await hashFiles(root, [path])] as const),
  );
  return Object.fromEntries(entries);
}

export function inspectPreparedBuild(
  stamp: PreparedBuildStamp | undefined,
  expectedInputFingerprint: string,
  expectedBun: string,
  currentOutputs: Readonly<Record<string, string>>,
): string[] {
  if (!stamp) return ["prepared build stamp is missing"];
  if (stamp.schemaVersion !== 2) return ["prepared build stamp schema is unsupported"];
  const errors: string[] = [];
  if (stamp.configuredBunVersion !== expectedBun) {
    errors.push(`prepared build configured Bun ${stamp.configuredBunVersion}; expected ${expectedBun}`);
  }
  for (const error of inspectRuntimeVersion(expectedBun, stamp.bunVersion, stamp.bunRevision)) {
    errors.push(`prepared build ${error}`);
  }
  if (stamp.inputFingerprint !== expectedInputFingerprint) errors.push("prepared build inputs are stale");
  for (const [path, fingerprint] of Object.entries(currentOutputs)) {
    if (stamp.outputs[path] !== fingerprint) errors.push(`prepared build output is stale: ${path}`);
  }
  for (const path of Object.keys(stamp.outputs)) {
    if (!(path in currentOutputs)) errors.push(`prepared build output is missing: ${path}`);
  }
  return errors;
}

export function preparedBuildStampPath(root: string): string {
  return resolve(root, "reports/verification/prepared-build.json");
}

export async function recordPreparedBuild(root: string): Promise<PreparedBuildStamp> {
  const configuredBunVersion = await expectedBunVersion(root);
  const runtime = await checkedBunRuntime(configuredBunVersion);
  const outputs = await preparedBuildOutputFingerprints(root);
  const stamp: PreparedBuildStamp = {
    schemaVersion: 2,
    configuredBunVersion,
    bunVersion: runtime.bunVersion,
    bunRevision: runtime.bunRevision,
    inputFingerprint: await preparedBuildInputFingerprint(root),
    outputs,
  };
  await mkdir(resolve(root, "reports/verification"), { recursive: true });
  await Bun.write(preparedBuildStampPath(root), `${JSON.stringify(stamp, null, 2)}\n`);
  return stamp;
}

export async function assertPreparedBuild(root: string): Promise<PreparedBuildStamp> {
  const expectedBun = await expectedBunVersion(root);
  await checkedBunRuntime(expectedBun);
  let stamp: PreparedBuildStamp | undefined;
  try {
    stamp = JSON.parse(await readFile(preparedBuildStampPath(root), "utf8")) as PreparedBuildStamp;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const errors = inspectPreparedBuild(
    stamp,
    await preparedBuildInputFingerprint(root),
    expectedBun,
    await preparedBuildOutputFingerprints(root),
  );
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return stamp as PreparedBuildStamp;
}

export async function ensurePreparedBuild(root: string): Promise<PreparedBuildStamp> {
  try {
    return await assertPreparedBuild(root);
  } catch {
    const child = Bun.spawn([process.execPath, "run", "build"], { cwd: root, stdout: "inherit", stderr: "inherit" });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`bun run build failed with exit code ${exitCode}`);
    return assertPreparedBuild(root);
  }
}
