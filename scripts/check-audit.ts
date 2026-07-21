import { join } from "node:path";

type DependencyMap = Readonly<Record<string, string>>;

type PackageManifest = {
  readonly name?: string;
  readonly private?: boolean;
  readonly workspaces?: readonly string[];
  readonly dependencies?: DependencyMap;
  readonly optionalDependencies?: DependencyMap;
};

type LockMetadata = {
  readonly dependencies?: DependencyMap;
  readonly optionalDependencies?: DependencyMap;
};

type Lockfile = {
  readonly packages?: Readonly<Record<string, readonly unknown[]>>;
};

type AuditAdvisory = {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly severity: string;
};

type AuditResult = Readonly<Record<string, readonly AuditAdvisory[]>>;

type AuditDisposition = {
  readonly advisory: string;
  readonly package: string;
  readonly expires: string;
  readonly acceptedBy: string;
  readonly rationale: string;
  readonly evidence: string;
};

type AuditPolicy = {
  readonly version: 1;
  readonly dispositions: readonly AuditDisposition[];
};

type LockEntry = {
  readonly actualName?: string;
  readonly dependencies: readonly string[];
};

type Finding = AuditAdvisory & {
  readonly advisory: string;
  readonly package: string;
};

const root = process.cwd();
const seriousSeverities = new Set(["high", "critical"]);

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

function runtimeDependencies(value: {
  readonly dependencies?: DependencyMap;
  readonly optionalDependencies?: DependencyMap;
}): string[] {
  return [...Object.keys(value.dependencies ?? {}), ...Object.keys(value.optionalDependencies ?? {})];
}

function packageNameFromReference(reference: string): string | undefined {
  const normalized = reference.startsWith("npm:") ? reference.slice(4) : reference;
  if (normalized.startsWith("file:") || normalized.startsWith("workspace:") || normalized.startsWith("link:")) {
    return undefined;
  }
  if (normalized.startsWith("@")) {
    const slash = normalized.indexOf("/");
    const version = normalized.lastIndexOf("@");
    return version > slash ? normalized.slice(0, version) : normalized;
  }
  const version = normalized.indexOf("@");
  return version > 0 ? normalized.slice(0, version) : normalized;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Bun.file(path).text()) as T;
}

async function loadManifests(rootManifest: PackageManifest): Promise<PackageManifest[]> {
  const paths = new Set([join(root, "package.json")]);
  for (const workspace of rootManifest.workspaces ?? []) {
    const glob = new Bun.Glob(`${workspace.replace(/\/$/, "")}/package.json`);
    for await (const path of glob.scan({ cwd: root, absolute: true, onlyFiles: true })) {
      paths.add(path);
    }
  }
  return Promise.all([...paths].sort().map(path => readJson<PackageManifest>(path)));
}

function buildLockIndex(lockfile: Lockfile): Map<string, LockEntry[]> {
  const index = new Map<string, LockEntry[]>();
  for (const [reference, value] of Object.entries(lockfile.packages ?? {})) {
    if (!Array.isArray(value)) continue;
    const dependencyName = packageNameFromReference(reference);
    const actualName = typeof value[0] === "string" ? packageNameFromReference(value[0]) : undefined;
    const metadata = (value[2] ?? {}) as LockMetadata;
    const entry = { actualName, dependencies: runtimeDependencies(metadata) } satisfies LockEntry;
    for (const name of new Set([dependencyName, actualName])) {
      if (!name) continue;
      const entries = index.get(name) ?? [];
      entries.push(entry);
      index.set(name, entries);
    }
  }
  return index;
}

async function productionPackages(): Promise<Set<string>> {
  const rootManifest = await readJson<PackageManifest>(join(root, "package.json"));
  const manifests = await loadManifests(rootManifest);
  const workspaceDependencies = new Map<string, readonly string[]>();
  const pending: string[] = [];

  for (const manifest of manifests) {
    if (manifest.name) workspaceDependencies.set(manifest.name, runtimeDependencies(manifest));
    if (manifest.private !== true) pending.push(...runtimeDependencies(manifest));
  }

  const lockfile = Bun.JSONC.parse(await Bun.file(join(root, "bun.lock")).text()) as Lockfile;
  const lockIndex = buildLockIndex(lockfile);
  const reachable = new Set<string>();

  while (pending.length > 0) {
    const name = pending.shift();
    if (!name || reachable.has(name)) continue;
    reachable.add(name);
    pending.push(...(workspaceDependencies.get(name) ?? []));
    for (const entry of lockIndex.get(name) ?? []) {
      if (entry.actualName && !reachable.has(entry.actualName)) pending.push(entry.actualName);
      pending.push(...entry.dependencies);
    }
  }

  return reachable;
}

async function runAudit(): Promise<AuditResult> {
  const child = Bun.spawn([process.execPath, "audit", "--json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  let result: AuditResult;
  try {
    result = JSON.parse(stdout) as AuditResult;
  } catch {
    throw new Error(`bun audit did not return valid JSON: ${stderr.trim() || stdout.trim()}`);
  }
  if (exitCode !== 0 && Object.keys(result).length === 0) {
    throw new Error(`bun audit failed without reporting an advisory: ${stderr.trim()}`);
  }
  return result;
}

async function loadPolicy(): Promise<AuditPolicy> {
  const policy = await readJson<AuditPolicy>(join(root, "audit-dispositions.json"));
  if (policy.version !== 1 || !Array.isArray(policy.dispositions)) {
    throw new Error("audit-dispositions.json must contain version 1 and a dispositions array");
  }
  for (const disposition of policy.dispositions) {
    const required = [
      disposition.advisory,
      disposition.package,
      disposition.expires,
      disposition.acceptedBy,
      disposition.rationale,
      disposition.evidence,
    ];
    if (required.some(value => typeof value !== "string" || value.trim().length === 0)) {
      throw new Error(
        "every audit disposition must contain advisory, package, expires, acceptedBy, rationale, and evidence",
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(disposition.expires)) {
      throw new Error(`invalid audit disposition expiry: ${disposition.expires}`);
    }
  }
  return policy;
}

function flatten(result: AuditResult): Finding[] {
  return Object.entries(result)
    .flatMap(([packageName, advisories]) =>
      advisories.map(advisory => ({
        ...advisory,
        advisory: advisory.url.split("/").at(-1) ?? String(advisory.id),
        package: packageName,
      })),
    )
    .sort((left, right) => left.package.localeCompare(right.package) || left.advisory.localeCompare(right.advisory));
}

function activeDisposition(finding: Finding, policy: AuditPolicy): AuditDisposition | undefined {
  const today = new Date().toISOString().slice(0, 10);
  return policy.dispositions.find(
    disposition =>
      disposition.package === finding.package &&
      (disposition.advisory === finding.advisory || disposition.advisory === String(finding.id)) &&
      disposition.expires >= today,
  );
}

function printFindings(title: string, findings: readonly Finding[], policy?: AuditPolicy): void {
  writeLine(`\n${title} (${findings.length})`);
  if (findings.length === 0) {
    writeLine("- none");
    return;
  }
  for (const finding of findings) {
    const disposition = policy ? activeDisposition(finding, policy) : undefined;
    const suffix = disposition ? `; accepted by ${disposition.acceptedBy} until ${disposition.expires}` : "";
    writeLine(`- [${finding.severity}] ${finding.advisory} ${finding.package}: ${finding.title}${suffix}`);
  }
}

async function main(): Promise<void> {
  const [result, production, policy] = await Promise.all([runAudit(), productionPackages(), loadPolicy()]);
  const findings = flatten(result);
  const productionFindings = findings.filter(finding => production.has(finding.package));
  const toolingFindings = findings.filter(finding => !production.has(finding.package));
  const blocked = productionFindings.filter(
    finding => seriousSeverities.has(finding.severity) && !activeDisposition(finding, policy),
  );

  writeLine(`Dependency audit classified ${findings.length} finding(s).`);
  printFindings("Production findings", productionFindings, policy);
  printFindings("Development/tooling findings (non-fatal)", toolingFindings);

  if (blocked.length > 0) {
    throw new Error(
      `${blocked.length} production high/critical advisory finding(s) require resolution or an accepted unexpired disposition`,
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
