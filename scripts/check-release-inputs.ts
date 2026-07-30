import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageNames = ["distube", "discordjs", "oceanic", "eris"] as const;
const adapterNames = ["discordjs", "oceanic", "eris"] as const;
const expectedVersion = "6.0.0";

interface ReleaseManifest {
  readonly name?: string;
  readonly version?: string;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export interface StableReleaseInputs {
  readonly manifests: Readonly<Record<string, ReleaseManifest>>;
  readonly changesetFiles: readonly string[];
  readonly statusEntries: readonly string[];
  readonly trackedPaths: readonly string[];
}

function statusPath(entry: string): string {
  return entry.slice(3).replace(/^"|"$/gu, "").replaceAll("\\", "/");
}

function isMachineLocal(entry: string): boolean {
  if (!entry.startsWith("?? ")) return false;
  const path = statusPath(entry);
  return path === ".gitnexusrc" || path.startsWith(".gitnexus/") || path.startsWith("reports/");
}

export function inspectStableReleaseInputs(input: StableReleaseInputs): string[] {
  const errors: string[] = [];
  for (const directory of packageNames) {
    const manifest = input.manifests[directory];
    if (!manifest) {
      errors.push(`packages/${directory}/package.json: missing release manifest`);
      continue;
    }
    if (manifest.version !== expectedVersion) {
      errors.push(
        `${manifest.name ?? directory}: expected version ${expectedVersion}, found ${manifest.version ?? "missing"}`,
      );
    }
  }
  for (const directory of adapterNames) {
    const manifest = input.manifests[directory];
    if (manifest?.peerDependencies?.distube !== `^${expectedVersion}`) {
      errors.push(`${manifest?.name ?? directory}: expected distube peer ^${expectedVersion}`);
    }
  }
  for (const file of input.changesetFiles) {
    if (file !== "README.md" && file !== "config.json") errors.push(`unconsumed changeset: .changeset/${file}`);
  }
  for (const entry of input.statusEntries) {
    if (!isMachineLocal(entry)) errors.push(`uncommitted release input: ${entry}`);
  }
  for (const path of input.trackedPaths) {
    if (path.endsWith(".tgz") || path === ".artifacts" || path.startsWith(".artifacts/")) {
      errors.push(`committed release residue: ${path}`);
    }
  }
  return errors;
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed\n${stdout}${stderr}`);
  return stdout;
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const manifests = Object.fromEntries(
    await Promise.all(
      packageNames.map(async directory => [
        directory,
        JSON.parse(await readFile(resolve(root, "packages", directory, "package.json"), "utf8")) as ReleaseManifest,
      ]),
    ),
  );
  const changesetFiles = (await readdir(resolve(root, ".changeset"))).sort();
  const statusEntries = (await git(["status", "--short", "--untracked-files=all"], root))
    .split(/\r?\n/u)
    .filter(Boolean);
  const trackedPaths = (await git(["ls-files"], root)).split(/\r?\n/u).filter(Boolean);
  const errors = inspectStableReleaseInputs({ manifests, changesetFiles, statusEntries, trackedPaths });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write("Stable release inputs are committed, complete, and residue-free.\n");
}

if (import.meta.main) await main();
