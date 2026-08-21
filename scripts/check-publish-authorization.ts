import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const candidatePattern = /^[a-f0-9]{64}$/u;
const evidenceGenerationPattern = /^[A-Za-z0-9_-]{16,128}$/u;
const revisionPattern = /^[a-f0-9]{40}$/u;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export const publicPackages = [
  { name: "distube", owner: "DisTube", directory: "packages/distube" },
  { name: "@distube/discordjs", owner: "DisTube", directory: "packages/discordjs" },
  { name: "@distube/oceanic", owner: "DisTube", directory: "packages/oceanic" },
  { name: "@distube/eris", owner: "DisTube", directory: "packages/eris" },
  { name: "@distube/youtube", owner: "plugins", directory: "packages/youtube" },
  { name: "@distube/spotify", owner: "plugins", directory: "packages/spotify" },
  { name: "@distube/soundcloud", owner: "plugins", directory: "packages/soundcloud" },
  { name: "@distube/lavalink", owner: "plugins", directory: "packages/lavalink" },
] as const;

type PackageOwner = "DisTube" | "plugins";
type RepositoryName = PackageOwner | "example";

interface FileEvidence {
  readonly path: string;
  readonly sha256: string;
}

interface RepositoryEvidence {
  readonly name: RepositoryName;
  readonly revision: string;
}

interface PackageEvidence {
  readonly name: string;
  readonly owner: PackageOwner;
  readonly version: string;
  readonly sourceRevision: string;
  readonly manifest: FileEvidence;
  readonly lockfile: FileEvidence;
  readonly readme: FileEvidence;
  readonly archive: FileEvidence;
  readonly declarations: readonly FileEvidence[];
}

interface ReleaseCandidateInput {
  readonly evidenceGeneration: string;
  readonly generatedAt: string;
  readonly publishAuthorized: boolean;
  readonly toolchain: unknown;
  readonly repositories: readonly RepositoryEvidence[];
  readonly packages: readonly PackageEvidence[];
  readonly records: unknown;
  readonly gates: readonly unknown[];
  readonly externalState: unknown;
  readonly postPublishVerification: unknown;
}

interface ReleaseCandidate extends ReleaseCandidateInput {
  readonly schemaVersion: 3;
  readonly candidateId: string;
}

export interface PublishAuthorizationInput {
  readonly workspaceRoot: string;
  readonly repositoryRoot: string;
  readonly candidatePath: string;
  readonly packageName: string;
  readonly archiveOperand: string;
  readonly authorizedCandidateId?: string;
  readonly publishAuthorized?: string;
  readonly releaseCandidateId?: string;
  readonly releaseSourceRevision?: string;
  readonly candidateSourceRevision?: string;
}

interface LocalPackage {
  readonly name: string;
  readonly version: string;
  readonly private: boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEvidence(value: unknown): value is FileEvidence {
  return isRecord(value) && typeof value.path === "string" && typeof value.sha256 === "string";
}

function isRepository(value: unknown): value is RepositoryEvidence {
  return isRecord(value) && typeof value.name === "string" && typeof value.revision === "string";
}

function isPackage(value: unknown): value is PackageEvidence {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.owner === "string" &&
    typeof value.version === "string" &&
    typeof value.sourceRevision === "string" &&
    isEvidence(value.manifest) &&
    isEvidence(value.lockfile) &&
    isEvidence(value.readme) &&
    isEvidence(value.archive) &&
    Array.isArray(value.declarations) &&
    value.declarations.every(isEvidence)
  );
}

function releaseCandidateInput(candidate: ReleaseCandidate): ReleaseCandidateInput {
  const { schemaVersion: _schemaVersion, candidateId: _candidateId, ...input } = candidate;
  return input;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function deterministicJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

/** Matches the root release-candidate v3 identity algorithm exactly. */
export function candidateIdentity(input: ReleaseCandidateInput): string {
  const identity = {
    evidenceGeneration: input.evidenceGeneration,
    toolchain: input.toolchain,
    repositories: [...input.repositories].sort((left, right) => left.name.localeCompare(right.name)),
    packages: [...input.packages].sort((left, right) => left.name.localeCompare(right.name)),
    records: input.records,
    gates: [...input.gates].sort((left, right) => {
      const leftGate = isRecord(left) ? left : {};
      const rightGate = isRecord(right) ? right : {};
      return (
        String(leftGate.repository ?? "").localeCompare(String(rightGate.repository ?? "")) ||
        String(leftGate.command ?? "").localeCompare(String(rightGate.command ?? ""))
      );
    }),
    externalState: input.externalState,
    postPublishVerification: input.postPublishVerification,
  };
  return createHash("sha256").update(deterministicJson(identity)).digest("hex");
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function pathError(path: string, label: string): string | undefined {
  const normalized = normalizePath(path);
  if (
    path !== normalized ||
    normalized.length === 0 ||
    isAbsolute(path) ||
    posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/u.test(normalized) ||
    posix.normalize(normalized) !== normalized ||
    normalized === "." ||
    normalized.startsWith("../")
  ) {
    return `${label}: path must be canonical and relative: ${path}`;
  }
  return undefined;
}

function archiveName(name: string, version: string): string {
  return `${name.replace(/^@/u, "").replaceAll("/", "-")}-${version}.tgz`;
}

function declarationPaths(packageName: string): readonly string[] {
  const baseName = packageName.replace(/^@/u, "").replaceAll("/", "-");
  return [`core/declarations/${baseName}.index.d.mts`, `core/declarations/${baseName}.index.d.cts`];
}

function expectedEvidencePaths(
  item: (typeof publicPackages)[number],
  version: string,
): {
  readonly manifest: string;
  readonly lockfile: string;
  readonly readme: string;
  readonly archive: string;
  readonly declarations: readonly string[];
} {
  const artifactOwner = item.owner === "DisTube" ? "core" : "plugins";
  const packageDirectory = item.directory.split("/").at(-1);
  if (!packageDirectory) throw new Error(`invalid package directory for ${item.name}`);
  return {
    manifest: `DisTube/${item.directory}/package.json`,
    lockfile: "DisTube/bun.lock",
    readme: `DisTube/${item.directory}/README.md`,
    archive: `${artifactOwner}/archives/${archiveName(item.name, version)}`,
    declarations:
      item.owner === "DisTube"
        ? declarationPaths(item.name)
        : [
            `plugins/declarations/${packageDirectory}.index.d.mts`,
            `plugins/declarations/${packageDirectory}.index.d.cts`,
          ],
  };
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function verifiedFile(
  base: string,
  evidence: FileEvidence,
  label: string,
  errors: string[],
): Promise<string | undefined> {
  const error = pathError(evidence.path, label);
  if (error) {
    errors.push(error);
    return undefined;
  }

  const resolved = resolve(base, evidence.path);
  if (normalizePath(relative(base, resolved)) !== evidence.path) {
    errors.push(`${label}: path escapes its evidence root: ${evidence.path}`);
    return undefined;
  }

  try {
    const realBase = await realpath(base);
    const baseStats = await lstat(base);
    if (baseStats.isSymbolicLink()) {
      errors.push(`${label}: evidence root must not be a symbolic link`);
      return undefined;
    }

    let current = base;
    for (const part of evidence.path.split("/")) {
      current = join(current, part);
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        errors.push(`${label}: symbolic links are not allowed: ${evidence.path}`);
        return undefined;
      }
    }

    const stats = await lstat(resolved);
    if (!stats.isFile()) {
      errors.push(`${label}: evidence path is not a regular file: ${evidence.path}`);
      return undefined;
    }
    const realFile = await realpath(resolved);
    if (normalizePath(relative(realBase, realFile)) !== evidence.path) {
      errors.push(`${label}: real path escapes its evidence root: ${evidence.path}`);
      return undefined;
    }
    const actual = await sha256File(resolved);
    if (actual !== evidence.sha256) {
      errors.push(`${label}: SHA-256 changed, recorded ${evidence.sha256}, fresh ${actual}`);
    }
    return resolved;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      errors.push(`${label}: evidence file is missing: ${evidence.path}`);
      return undefined;
    }
    errors.push(`${label}: could not verify evidence: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function readCandidate(path: string, errors: string[]): Promise<ReleaseCandidate | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      !isRecord(value) ||
      value.schemaVersion !== 3 ||
      typeof value.candidateId !== "string" ||
      typeof value.evidenceGeneration !== "string" ||
      !evidenceGenerationPattern.test(value.evidenceGeneration) ||
      !Array.isArray(value.repositories) ||
      !Array.isArray(value.packages) ||
      !Array.isArray(value.gates) ||
      !isRecord(value.records)
    ) {
      errors.push(`${path}: unsupported or malformed release candidate`);
      return undefined;
    }
    return value as unknown as ReleaseCandidate;
  } catch (error) {
    errors.push(`${path}: candidate evidence is required: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function currentRevision(repositoryRoot: string, errors: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot });
    return stdout.trim();
  } catch (error) {
    errors.push(`current checkout revision is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function localPackages(repositoryRoot: string, errors: string[]): Promise<Map<string, LocalPackage>> {
  const discovered = new Map<string, LocalPackage>();
  for (const item of publicPackages.filter(candidate => candidate.owner === "DisTube")) {
    const manifestPath = resolve(repositoryRoot, item.directory, "package.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      if (!isRecord(manifest) || typeof manifest.name !== "string" || typeof manifest.version !== "string") {
        errors.push(`${item.name}: local package manifest is malformed`);
        continue;
      }
      const local = { name: manifest.name, version: manifest.version, private: manifest.private === true };
      if (discovered.has(local.name)) errors.push(`local public package inventory duplicates ${local.name}`);
      discovered.set(local.name, local);
    } catch (error) {
      errors.push(
        `${item.name}: local public package manifest is missing: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return discovered;
}

function validateCandidateMembership(candidate: ReleaseCandidate, errors: string[]): Map<string, PackageEvidence> {
  const expected = new Map<string, (typeof publicPackages)[number]>(publicPackages.map(item => [item.name, item]));
  const packages = new Map<string, PackageEvidence>();
  if (candidate.packages.length !== publicPackages.length) {
    errors.push(`release candidate must contain exactly eight public packages, found ${candidate.packages.length}`);
  }
  for (const item of candidate.packages) {
    if (!isPackage(item)) {
      errors.push("release candidate contains malformed package evidence");
      continue;
    }
    if (packages.has(item.name)) {
      errors.push(`release candidate package names must be unique: ${item.name}`);
      continue;
    }
    packages.set(item.name, item);
    const expectedItem = expected.get(item.name);
    if (!expectedItem) {
      if (item.name === "@distube/voice-core")
        errors.push("release candidate includes private package @distube/voice-core");
      else errors.push(`release candidate includes unexpected package ${item.name}`);
      continue;
    }
    if (item.owner !== expectedItem.owner) {
      errors.push(`${item.name}: owner must be ${expectedItem.owner}, found ${item.owner}`);
    }
  }
  for (const name of expected.keys()) {
    if (!packages.has(name)) errors.push(`release candidate omits ${name}`);
  }
  return packages;
}

function repositoryEvidence(candidate: ReleaseCandidate, errors: string[]): Map<RepositoryName, RepositoryEvidence> {
  const repositories = new Map<RepositoryName, RepositoryEvidence>();
  for (const item of candidate.repositories) {
    if (!isRepository(item) || !["DisTube", "plugins", "example"].includes(item.name)) {
      errors.push("release candidate contains malformed repository evidence");
      continue;
    }
    const name = item.name as RepositoryName;
    if (repositories.has(name)) errors.push(`release candidate repository names must be unique: ${name}`);
    else repositories.set(name, item);
  }
  for (const name of ["DisTube", "plugins", "example"] as const) {
    if (!repositories.has(name)) errors.push(`release candidate omits repository ${name}`);
  }
  return repositories;
}

function expectPath(actual: string, expected: string, label: string, errors: string[]): void {
  if (actual !== expected) errors.push(`${label}: expected canonical path ${expected}, found ${actual}`);
}

function validateLegacyEnvironment(
  input: PublishAuthorizationInput,
  candidate: ReleaseCandidate,
  errors: string[],
): void {
  if (input.publishAuthorized !== undefined && input.publishAuthorized !== "false") {
    errors.push("legacy PUBLISH_AUTHORIZED must remain false for candidate-backed authorization");
  }
  if (input.releaseCandidateId !== undefined && input.releaseCandidateId !== candidate.candidateId) {
    errors.push("legacy RELEASE_CANDIDATE_ID differs from candidate evidence");
  }
  if (input.releaseSourceRevision !== undefined || input.candidateSourceRevision !== undefined) {
    if (input.candidateSourceRevision !== input.releaseSourceRevision) {
      errors.push("legacy release source revision differs from candidate source revision");
    }
  }
}

export async function inspectPublishAuthorization(input: PublishAuthorizationInput): Promise<string[]> {
  const errors: string[] = [];
  const candidate = await readCandidate(input.candidatePath, errors);
  if (!candidate) return errors;

  if (candidate.publishAuthorized !== false) {
    errors.push("release candidate must remain unauthorized");
  }
  const expectedCandidateId = candidateIdentity(releaseCandidateInput(candidate));
  if (candidate.candidateId !== expectedCandidateId) {
    errors.push(`stale candidateId, recorded ${candidate.candidateId}, recomputed ${expectedCandidateId}`);
  }
  if (!input.authorizedCandidateId || !candidatePattern.test(input.authorizedCandidateId)) {
    errors.push("AUTHORIZED_RELEASE_CANDIDATE_ID is missing or invalid");
  } else if (input.authorizedCandidateId !== candidate.candidateId) {
    errors.push("AUTHORIZED_RELEASE_CANDIDATE_ID does not name the candidate evidence");
  }
  validateLegacyEnvironment(input, candidate, errors);

  const packages = validateCandidateMembership(candidate, errors);
  const repositories = repositoryEvidence(candidate, errors);
  const selected = packages.get(input.packageName);
  const expected = publicPackages.find(item => item.name === input.packageName);
  if (!expected) {
    errors.push(`selected package is not a canonical public package: ${input.packageName}`);
    return errors;
  }
  if (expected.owner !== "DisTube") {
    errors.push(`${input.packageName}: this core workflow may publish only DisTube-owned packages`);
    return errors;
  }
  if (!selected) return errors;
  if (!versionPattern.test(selected.version))
    errors.push(`${selected.name}: invalid package version ${selected.version}`);

  const local = await localPackages(input.repositoryRoot, errors);
  const localPackage = local.get(selected.name);
  if (!localPackage) {
    errors.push(`${selected.name}: local public package inventory omits selected package`);
  } else {
    if (localPackage.private) errors.push(`${selected.name}: selected local package must be public`);
    if (localPackage.version !== selected.version) {
      errors.push(`${selected.name}: local version ${localPackage.version} differs from candidate ${selected.version}`);
    }
  }

  const expectedPaths = expectedEvidencePaths(expected, selected.version);
  expectPath(selected.manifest.path, expectedPaths.manifest, `${selected.name}: manifest`, errors);
  expectPath(selected.lockfile.path, expectedPaths.lockfile, `${selected.name}: lockfile`, errors);
  expectPath(selected.readme.path, expectedPaths.readme, `${selected.name}: README`, errors);
  expectPath(selected.archive.path, expectedPaths.archive, `${selected.name}: archive`, errors);
  const declarations = new Map(selected.declarations.map(item => [item.path, item]));
  if (declarations.size !== selected.declarations.length)
    errors.push(`${selected.name}: declaration evidence paths must be unique`);
  if (declarations.size !== expectedPaths.declarations.length) {
    errors.push(`${selected.name}: declaration evidence must contain every package declaration`);
  }
  for (const path of expectedPaths.declarations) {
    if (!declarations.has(path)) errors.push(`${selected.name}: declaration evidence omits ${path}`);
  }
  for (const path of declarations.keys()) {
    if (!expectedPaths.declarations.includes(path)) {
      errors.push(`${selected.name}: declaration path is not canonical: ${path}`);
    }
  }

  const recordedRepository = repositories.get("DisTube");
  const revision = await currentRevision(input.repositoryRoot, errors);
  if (recordedRepository && !revisionPattern.test(recordedRepository.revision)) {
    errors.push("DisTube: candidate repository revision is invalid");
  }
  if (revision && recordedRepository && revision !== recordedRepository.revision) {
    errors.push(`DisTube: checkout revision changed, recorded ${recordedRepository.revision}, fresh ${revision}`);
  }
  if (recordedRepository && selected.sourceRevision !== recordedRepository.revision) {
    errors.push(`${selected.name}: source revision differs from owning repository`);
  }

  const artifactRoot = dirname(input.candidatePath);
  await verifiedFile(input.workspaceRoot, selected.manifest, `${selected.name}: manifest`, errors);
  await verifiedFile(input.workspaceRoot, selected.lockfile, `${selected.name}: lockfile`, errors);
  await verifiedFile(input.workspaceRoot, selected.readme, `${selected.name}: README`, errors);
  const archive = await verifiedFile(artifactRoot, selected.archive, `${selected.name}: archive`, errors);
  for (const declaration of selected.declarations) {
    await verifiedFile(artifactRoot, declaration, `${selected.name}: declaration ${declaration.path}`, errors);
  }

  if (archive) {
    const operand = resolve(input.repositoryRoot, input.archiveOperand);
    if (operand !== archive) {
      errors.push(`${selected.name}: archive operand does not exactly match candidate archive path`);
    }
  }
  return errors;
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const workspaceRoot = resolve(repositoryRoot, "..");
  const packageName = option("package");
  const archiveOperand = option("archive");
  const candidateDirectory = option("candidate-dir") ?? "../.artifacts/release-candidate";
  const candidatePath = resolve(repositoryRoot, candidateDirectory, "manifest.json");
  if (!packageName || !archiveOperand) {
    throw new Error(
      "usage: check-publish-authorization.ts --candidate-dir=<candidate evidence> --package=<name> --archive=<candidate archive>",
    );
  }
  const errors = await inspectPublishAuthorization({
    workspaceRoot,
    repositoryRoot,
    candidatePath,
    packageName,
    archiveOperand,
    authorizedCandidateId: process.env.AUTHORIZED_RELEASE_CANDIDATE_ID,
    publishAuthorized: process.env.PUBLISH_AUTHORIZED,
    releaseCandidateId: process.env.RELEASE_CANDIDATE_ID,
    releaseSourceRevision: process.env.RELEASE_SOURCE_REVISION,
    candidateSourceRevision: process.env.CANDIDATE_DISTUBE_REVISION,
  });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write(`Candidate-backed authorization verified for ${packageName}.\n`);
}
