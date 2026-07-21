import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly exports?: Readonly<Record<string, unknown>>;
}

export interface ExportTarget {
  readonly condition: string;
  readonly subpath: string;
  readonly target: string;
}

export function collectExportTargets(exports: Readonly<Record<string, unknown>> | undefined): readonly ExportTarget[] {
  const targets: ExportTarget[] = [];

  function collect(subpath: string, condition: string, value: unknown): void {
    if (typeof value === "string") {
      targets.push(Object.freeze({ condition, subpath, target: value }));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [nestedCondition, nestedValue] of Object.entries(value)) {
      collect(subpath, condition ? `${condition}.${nestedCondition}` : nestedCondition, nestedValue);
    }
  }

  for (const [subpath, value] of Object.entries(exports ?? {})) collect(subpath, "", value);
  return Object.freeze(targets);
}

export function runtimeTarget(
  exports: Readonly<Record<string, unknown>>,
  subpath: string,
  mode: "import" | "require",
): string {
  const entry = exports[subpath];
  if (!entry || typeof entry !== "object") throw new Error(`Missing package export ${subpath}`);
  const modeEntry = (entry as Readonly<Record<string, unknown>>)[mode];
  if (typeof modeEntry === "string") return modeEntry;
  if (modeEntry && typeof modeEntry === "object") {
    const target = (modeEntry as Readonly<Record<string, unknown>>).default;
    if (typeof target === "string") return target;
  }
  throw new Error(`Missing ${subpath} ${mode} runtime target`);
}

export function assertExportTargetsExist(packageRoot: string, manifest: PackageManifest): void {
  const targets = collectExportTargets(manifest.exports);
  if (targets.length === 0) throw new Error(`${manifest.name}: exports must not be empty`);
  for (const { condition, subpath, target } of targets) {
    if (!target.startsWith("./dist/")) {
      throw new Error(`${manifest.name}: ${subpath} ${condition} must target dist: ${target}`);
    }
    if (!existsSync(resolve(packageRoot, target))) {
      throw new Error(`${manifest.name}: missing built export ${subpath} ${condition}: ${target}`);
    }
  }
}

export async function cleanBuildOutput(packageRoot: string): Promise<void> {
  await rm(resolve(packageRoot, "dist"), { recursive: true, force: true });
}

export async function assertNoRepositoryResidue(packageRoot: string): Promise<void> {
  const forbidden = new Set([".git", ".gitnexus", "coverage", "node_modules", "openspec", "reports", "tests"]);
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (forbidden.has(entry.name)) throw new Error(`Packed package contains repository residue: ${entry.name}`);
  }
}

export async function readManifest(packageRoot: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as PackageManifest;
}
