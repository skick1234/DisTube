import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { candidateIdentity, inspectPublishAuthorization, publicPackages } from "./check-publish-authorization";

const temporaryRoots: string[] = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true }))));

type Candidate = Record<string, unknown>;

interface Fixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly candidatePath: string;
  readonly candidate: Candidate;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function hash(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

async function initializeRepository(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.email", "release-test@example.invalid");
  git(root, "config", "user.name", "Release Test");
}

function packageDirectory(name: string): string {
  const item = publicPackages.find(candidate => candidate.name === name);
  if (!item) throw new Error(`unknown fixture package ${name}`);
  return item.directory;
}

function owner(name: string): "DisTube" | "plugins" {
  const item = publicPackages.find(candidate => candidate.name === name);
  if (!item) throw new Error(`unknown fixture package ${name}`);
  return item.owner;
}

function archiveName(name: string): string {
  return `${name.replace(/^@/u, "").replaceAll("/", "-")}-6.0.0.tgz`;
}

async function createPackage(root: string, name: string): Promise<void> {
  const repository = owner(name);
  const directory = packageDirectory(name);
  const packageRoot = resolve(root, repository, directory);
  await mkdir(resolve(packageRoot, "dist"), { recursive: true });
  await writeFile(
    resolve(packageRoot, "package.json"),
    `${JSON.stringify({ name, version: "6.0.0", private: false })}\n`,
  );
  await writeFile(resolve(packageRoot, "README.md"), `# ${name}\n`);
  await writeFile(resolve(packageRoot, "dist/index.d.mts"), `export declare const name: "${name}";\n`);
}

function packages(candidate: Candidate): Candidate[] {
  return candidate.packages as Candidate[];
}

function selected(candidate: Candidate, name = "distube"): Candidate {
  const item = packages(candidate).find(candidatePackage => candidatePackage.name === name);
  if (!item) throw new Error(`fixture candidate omits ${name}`);
  return item;
}

function input(candidate: Candidate): Parameters<typeof candidateIdentity>[0] {
  return candidate as unknown as Parameters<typeof candidateIdentity>[0];
}

async function writeCandidate(path: string, candidate: Candidate, refresh = true): Promise<void> {
  if (refresh) candidate.candidateId = candidateIdentity(input(candidate));
  await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`);
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(resolve(tmpdir(), "distube-publish-authorization-"));
  temporaryRoots.push(root);
  const repositoryRoot = resolve(root, "DisTube");
  const pluginsRoot = resolve(root, "plugins");
  const exampleRoot = resolve(root, "example");
  await Promise.all([
    initializeRepository(repositoryRoot),
    initializeRepository(pluginsRoot),
    initializeRepository(exampleRoot),
  ]);
  await Promise.all(publicPackages.map(item => createPackage(root, item.name)));
  await writeFile(resolve(repositoryRoot, "bun.lock"), "core lock\n");
  await writeFile(resolve(pluginsRoot, "bun.lock"), "plugin lock\n");
  await writeFile(resolve(exampleRoot, "package.json"), '{"private":true}\n');
  for (const repository of [repositoryRoot, pluginsRoot, exampleRoot]) {
    git(repository, "add", ".");
    git(repository, "commit", "-q", "-m", "fixture baseline");
  }

  const artifactRoot = resolve(root, ".artifacts/release-candidate");
  await Promise.all([
    mkdir(resolve(artifactRoot, "core/archives"), { recursive: true }),
    mkdir(resolve(artifactRoot, "core/declarations"), { recursive: true }),
    mkdir(resolve(artifactRoot, "plugins/archives"), { recursive: true }),
    mkdir(resolve(artifactRoot, "plugins/declarations"), { recursive: true }),
  ]);
  const revisions = {
    DisTube: git(repositoryRoot, "rev-parse", "HEAD"),
    plugins: git(pluginsRoot, "rev-parse", "HEAD"),
    example: git(exampleRoot, "rev-parse", "HEAD"),
  };
  const evidence = await Promise.all(
    publicPackages.map(async item => {
      const artifactOwner = item.owner === "DisTube" ? "core" : "plugins";
      const directory = item.directory.split("/").at(-1);
      if (!directory) throw new Error("fixture package directory is missing");
      const archivePath = resolve(artifactRoot, artifactOwner, "archives", archiveName(item.name));
      const declarationBase = item.name.replace(/^@/u, "").replaceAll("/", "-");
      const declarationMts = resolve(artifactRoot, artifactOwner, "declarations", `${declarationBase}.index.d.mts`);
      await writeFile(archivePath, `${item.name} archive\n`);
      await writeFile(declarationMts, `export declare const packageName: "${item.name}";\n`);
      const packageRoot = resolve(root, item.owner, item.directory);
      return {
        name: item.name,
        owner: item.owner,
        order: item.name === "distube" ? 1 : item.owner === "DisTube" ? 2 : 3,
        version: "6.0.0",
        peerDependencies: item.name === "distube" ? {} : { distube: "^6.0.0" },
        sourceRevision: revisions[item.owner],
        manifest: {
          path: `${item.owner}/${item.directory}/package.json`,
          sha256: await hash(resolve(packageRoot, "package.json")),
        },
        lockfile: { path: `${item.owner}/bun.lock`, sha256: await hash(resolve(root, item.owner, "bun.lock")) },
        readme: {
          path: `${item.owner}/${item.directory}/README.md`,
          sha256: await hash(resolve(packageRoot, "README.md")),
        },
        archive: {
          path: `${artifactOwner}/archives/${archiveName(item.name)}`,
          sha256: await hash(archivePath),
        },
        declarations: [
          {
            path: `${artifactOwner}/declarations/${declarationBase}.index.d.mts`,
            sha256: await hash(declarationMts),
          },
        ],
        upstreamArchives: {},
      };
    }),
  );
  const gates = [{ repository: "workspace", command: "fixture", status: "passed", bunVersion: "1.4.0", warnings: [] }];
  const candidate: Candidate = {
    schemaVersion: 3,
    evidenceGeneration: "candidate-evidence-2026",
    generatedAt: "2026-08-22T00:00:00.000Z",
    publishAuthorized: false,
    toolchain: { expectedBun: "1.4.0", observedBun: "1.4.0" },
    repositories: [
      {
        name: "DisTube",
        revision: revisions.DisTube,
        branch: "main",
        contentSha256: "a".repeat(64),
        releaseInputStatus: [],
      },
      {
        name: "plugins",
        revision: revisions.plugins,
        branch: "main",
        contentSha256: "b".repeat(64),
        releaseInputStatus: [],
      },
      {
        name: "example",
        revision: revisions.example,
        branch: "main",
        contentSha256: "c".repeat(64),
        releaseInputStatus: [],
      },
    ],
    packages: evidence,
    records: {
      gates: { path: "gates.json", sha256: "d".repeat(64) },
      externalState: { path: "external-state.json", sha256: "e".repeat(64) },
    },
    gates,
    externalState: {},
    postPublishVerification: [],
  };
  const candidatePath = resolve(artifactRoot, "manifest.json");
  await writeCandidate(candidatePath, candidate);
  return { root, repositoryRoot, candidatePath, candidate };
}

async function inspect(fixture: Fixture, candidate = fixture.candidate, packageName = "distube"): Promise<string[]> {
  await writeCandidate(fixture.candidatePath, candidate);
  return inspectPublishAuthorization({
    workspaceRoot: fixture.root,
    repositoryRoot: fixture.repositoryRoot,
    candidatePath: fixture.candidatePath,
    packageName,
    archiveOperand: `../.artifacts/release-candidate/core/archives/${archiveName(packageName)}`,
    authorizedCandidateId: String(candidate.candidateId),
  });
}

function expectError(errors: readonly string[], fragment: string): void {
  expect(errors.some(error => error.includes(fragment))).toBe(true);
}

describe("candidate-backed publish authorization", () => {
  test("accepts only fresh candidate-backed archive evidence", async () => {
    const fixture = await createFixture();
    expect(await inspect(fixture)).toEqual([]);
  });

  test("matches schema-v3 identity fields and ignores unrelated top-level metadata", async () => {
    const fixture = await createFixture();
    const initial = candidateIdentity(input(fixture.candidate));
    fixture.candidate.note = "release notes are not candidate identity";
    expect(candidateIdentity(input(fixture.candidate))).toBe(initial);
    fixture.candidate.evidenceGeneration = "candidate-evidence-2027";
    expect(candidateIdentity(input(fixture.candidate))).not.toBe(initial);
  });

  test("accepts package-name-based adapter declaration evidence", async () => {
    const fixture = await createFixture();
    expect(await inspect(fixture, fixture.candidate, "@distube/discordjs")).toEqual([]);
  });

  test("rejects an absent package and anything other than the exact eight public packages", async () => {
    const fixture = await createFixture();
    fixture.candidate.packages = packages(fixture.candidate).filter(item => item.name !== "@distube/lavalink");
    expectError(await inspect(fixture), "release candidate must contain exactly eight public packages");
    expectError(await inspect(fixture), "release candidate omits @distube/lavalink");
  });

  test("rejects duplicate package evidence", async () => {
    const fixture = await createFixture();
    fixture.candidate.packages = [...packages(fixture.candidate), structuredClone(selected(fixture.candidate))];
    expectError(await inspect(fixture), "release candidate package names must be unique");
  });

  test("rejects a private package and wrong canonical owner", async () => {
    const fixture = await createFixture();
    fixture.candidate.packages = [
      ...packages(fixture.candidate),
      { ...selected(fixture.candidate), name: "@distube/voice-core" },
    ];
    selected(fixture.candidate, "@distube/youtube").owner = "DisTube";
    const errors = await inspect(fixture);
    expectError(errors, "release candidate includes private package @distube/voice-core");
    expectError(errors, "@distube/youtube: owner must be plugins");
  });

  test("rejects wrong package versions and source revisions", async () => {
    const fixture = await createFixture();
    selected(fixture.candidate).version = "6.0.1";
    selected(fixture.candidate).sourceRevision = "f".repeat(40);
    const errors = await inspect(fixture);
    expectError(errors, "local version 6.0.0 differs from candidate 6.0.1");
    expectError(errors, "source revision differs from owning repository");
  });

  test("rejects a changed manifest, lockfile, README, declaration, and archive", async () => {
    const paths = [
      "DisTube/packages/distube/package.json",
      "DisTube/bun.lock",
      "DisTube/packages/distube/README.md",
      ".artifacts/release-candidate/core/declarations/distube.index.d.mts",
      ".artifacts/release-candidate/core/archives/distube-6.0.0.tgz",
    ];
    for (const path of paths) {
      const fixture = await createFixture();
      await writeFile(resolve(fixture.root, path), "changed\n");
      expectError(await inspect(fixture), "SHA-256 changed");
    }
  });

  test("rejects changed archive paths and archive operands", async () => {
    const fixture = await createFixture();
    (selected(fixture.candidate).archive as Candidate).path = "core/archives/renamed.tgz";
    expectError(await inspect(fixture), "archive: expected canonical path");

    const fresh = await createFixture();
    await writeCandidate(fresh.candidatePath, fresh.candidate);
    const errors = await inspectPublishAuthorization({
      workspaceRoot: fresh.root,
      repositoryRoot: fresh.repositoryRoot,
      candidatePath: fresh.candidatePath,
      packageName: "distube",
      archiveOperand: "../.artifacts/release-candidate/core/archives/other.tgz",
      authorizedCandidateId: String(fresh.candidate.candidateId),
    });
    expectError(errors, "archive operand does not exactly match candidate archive path");
  });

  test("rejects stale candidate fingerprints and publish-authorized candidates", async () => {
    const fixture = await createFixture();
    fixture.candidate.externalState = { changed: true };
    await writeCandidate(fixture.candidatePath, fixture.candidate, false);
    expectError(
      await inspectPublishAuthorization({
        workspaceRoot: fixture.root,
        repositoryRoot: fixture.repositoryRoot,
        candidatePath: fixture.candidatePath,
        packageName: "distube",
        archiveOperand: "../.artifacts/release-candidate/core/archives/distube-6.0.0.tgz",
        authorizedCandidateId: String(fixture.candidate.candidateId),
      }),
      "stale candidateId",
    );

    const authorized = await createFixture();
    authorized.candidate.publishAuthorized = true;
    expectError(await inspect(authorized), "release candidate must remain unauthorized");
  });

  test("rejects environment-only authorization", async () => {
    const fixture = await createFixture();
    const errors = await inspectPublishAuthorization({
      workspaceRoot: fixture.root,
      repositoryRoot: fixture.repositoryRoot,
      candidatePath: resolve(fixture.root, ".artifacts/release-candidate/missing.json"),
      packageName: "distube",
      archiveOperand: "../.artifacts/release-candidate/core/archives/distube-6.0.0.tgz",
      authorizedCandidateId: "a".repeat(64),
      publishAuthorized: "true",
      releaseCandidateId: "a".repeat(64),
      releaseSourceRevision: "b".repeat(40),
      candidateSourceRevision: "b".repeat(40),
    });
    expectError(errors, "candidate evidence is required");
  });

  test("rejects absolute and traversal evidence paths", async () => {
    const absolute = await createFixture();
    (selected(absolute.candidate).manifest as Candidate).path = "/tmp/package.json";
    expectError(await inspect(absolute), "path must be canonical and relative");

    const traversal = await createFixture();
    (selected(traversal.candidate).archive as Candidate).path = "../core/archives/distube-6.0.0.tgz";
    expectError(await inspect(traversal), "path must be canonical and relative");
  });

  test("rejects symbolic-link evidence paths", async () => {
    const fixture = await createFixture();
    const archive = resolve(fixture.root, ".artifacts/release-candidate/core/archives/distube-6.0.0.tgz");
    const replacement = resolve(fixture.root, "replacement.tgz");
    await writeFile(replacement, "distube archive\n");
    await rm(archive);
    await symlink(relative(resolve(fixture.root, ".artifacts/release-candidate/core/archives"), replacement), archive);
    const evidence = selected(fixture.candidate).archive as Candidate;
    evidence.sha256 = await hash(replacement);
    expectError(await inspect(fixture), "symbolic links are not allowed");
  });
});
