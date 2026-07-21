import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const MANIFEST_SECTIONS = [...DEPENDENCY_SECTIONS, "overrides"] as const;

interface DeprecationDisposition {
  readonly id: string;
  readonly classification: "project-actionable" | "upstream-only" | "false-positive";
  readonly resolved?: boolean;
  readonly owner?: string;
  readonly evidence?: string;
  readonly risk?: string;
  readonly recheckCondition?: string;
}

interface LocalContract {
  readonly manifest: string;
  readonly section: "dependencies" | "devDependencies" | "overrides";
  readonly packageName: string;
  readonly sha256: string;
}

interface DependencyPolicy {
  readonly packageManager: string;
  readonly lockfileVersion: number;
  readonly manifests: Readonly<
    Record<string, Readonly<Partial<Record<(typeof MANIFEST_SECTIONS)[number], Readonly<Record<string, string>>>>>>
  >;
  readonly allowedPrereleases: readonly string[];
  readonly peerEvidence: Readonly<Record<string, string>>;
  readonly localContracts: readonly LocalContract[];
  readonly deprecations: readonly DeprecationDisposition[];
}

const root = resolve(import.meta.dir, "..");
const ignored = new Set([".git", ".gitnexus", "dist", "node_modules", "reports"]);

async function manifests(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await manifests(path)));
    else if (entry.name === "package.json") paths.push(path);
  }
  return paths.sort();
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(stable(item))));
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, JSON.parse(stable(item))]),
    ),
  );
}

async function fingerprint(path: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

function validateDeprecations(dispositions: readonly DeprecationDisposition[]): string[] {
  const errors: string[] = [];
  const now = new Date();
  for (const item of dispositions) {
    if (!["project-actionable", "upstream-only", "false-positive"].includes(item.classification)) {
      errors.push(`${item.id}: deprecation finding is unclassified`);
      continue;
    }
    if (item.classification === "project-actionable" && !item.resolved) {
      errors.push(`${item.id}: project-actionable finding is unresolved`);
    }
    if (item.classification === "upstream-only") {
      if (!item.owner || !item.evidence || !item.risk || !item.recheckCondition) {
        errors.push(`${item.id}: upstream-only disposition is incomplete`);
      }
      if (item.recheckCondition?.startsWith("date:")) {
        const expiry = new Date(item.recheckCondition.slice(5));
        if (Number.isNaN(expiry.valueOf()) || expiry <= now) errors.push(`${item.id}: recheck date expired`);
      }
    }
    if (item.classification === "false-positive" && !item.evidence) {
      errors.push(`${item.id}: false-positive disposition requires evidence`);
    }
  }
  return errors;
}

const policy = JSON.parse(await readFile(resolve(root, "dependency-policy.json"), "utf8")) as DependencyPolicy;
const errors: string[] = [];
const rootManifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
  packageManager?: string;
};
if (rootManifest.packageManager !== policy.packageManager) {
  errors.push(`packageManager: expected ${policy.packageManager}, found ${rootManifest.packageManager ?? "missing"}`);
}

const lock = await readFile(resolve(root, "bun.lock"), "utf8");
if (!new RegExp(`"lockfileVersion"\\s*:\\s*${policy.lockfileVersion}(?:,|\\s)`).test(lock)) {
  errors.push(`bun.lock: expected lockfileVersion ${policy.lockfileVersion}`);
}

const actualManifestPaths = await manifests(root);
const actualNames = actualManifestPaths.map(path => relative(root, path));
const expectedNames = Object.keys(policy.manifests).sort();
if (stable(actualNames) !== stable(expectedNames)) {
  errors.push(`manifest inventory mismatch: expected ${expectedNames.join(", ")}, found ${actualNames.join(", ")}`);
}

for (const manifestPath of actualManifestPaths) {
  const name = relative(root, manifestPath);
  const contents = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const expected = policy.manifests[name] ?? {};
  for (const section of MANIFEST_SECTIONS) {
    const actualValues = contents[section] ?? {};
    const expectedValues = expected[section] ?? {};
    if (stable(actualValues) !== stable(expectedValues)) {
      errors.push(`${name}:${section} differs from dependency-policy.json`);
    }
    if (section === "peerDependencies" && actualValues && typeof actualValues === "object") {
      for (const packageName of Object.keys(actualValues)) {
        const key = `${name}:${packageName}`;
        if (!policy.peerEvidence[key]) errors.push(`${key}: peer range lacks compatibility evidence`);
      }
    }
    if (section !== "overrides" && actualValues && typeof actualValues === "object") {
      for (const [packageName, specifier] of Object.entries(actualValues)) {
        if (typeof specifier !== "string" || specifier.startsWith("file:") || specifier.startsWith("workspace:"))
          continue;
        if (/\\d+\\.\\d+\\.\\d+-[0-9A-Za-z]/.test(specifier)) {
          const key = `${name}:${section}:${packageName}`;
          if (!policy.allowedPrereleases.includes(key)) errors.push(`${key}: prerelease is not explicitly allowed`);
        }
      }
    }
  }
}

for (const contract of policy.localContracts) {
  const manifestPath = resolve(root, contract.manifest);
  const contents = JSON.parse(await readFile(manifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };
  const specifier = contents[contract.section]?.[contract.packageName];
  if (!specifier?.startsWith("file:")) {
    errors.push(`${contract.manifest}:${contract.packageName}: local contract declaration is missing`);
    continue;
  }
  const path = resolve(dirname(manifestPath), specifier.slice("file:".length));
  try {
    const actual = await fingerprint(path);
    if (actual !== contract.sha256) {
      errors.push(`${contract.manifest}:${contract.packageName}: expected ${contract.sha256}, found ${actual}`);
    }
  } catch {
    errors.push(`${contract.manifest}:${contract.packageName}: local contract file is missing`);
  }
}

errors.push(...validateDeprecations(policy.deprecations));
if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exit(1);
}
process.stdout.write(
  `Dependency policy valid: ${actualNames.length} manifests, ${policy.localContracts.length} local contracts, ${policy.deprecations.length} warning dispositions.\n`,
);
