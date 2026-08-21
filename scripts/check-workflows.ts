import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { commandPrecedes, parseWorkflow, runContains, type WorkflowDocument } from "./workflow-structure";

export interface WorkflowPolicy {
  readonly file: string;
  readonly requiredCommands: readonly string[];
  readonly corePackages?: readonly { name: string; version: string }[];
}

export const requiredVerifyCommands = [
  "bun run check:runtime",
  "bun run check",
  "bun run check:dependencies",
  "bun run type",
  "bun run test:release",
  "bun run build",
  "bun run check:prepared-build",
  "bun run check:circular",
  "bun run api-report:prepared",
  "bun run check:packages:prepared",
  "bun run check:local-playback",
  "bun run check:adapter-compatibility:prepared",
  "bun run docs:prepared",
  "bun run check:critical-quality",
  "bun run check:audit",
  "bun run check:workflows",
] as const;

const supersededVerifyCommands = [
  "bun run test",
  "bun run api-report",
  "bun run check:packages",
  "bun run check:adapter-compatibility",
  "bun run docs",
  "bun run test:critical-quality",
] as const;

export function inspectVerifyScript(script: string, required = requiredVerifyCommands): string[] {
  const commands = script
    .split(/\s*&&\s*/u)
    .map(command => command.trim())
    .filter(Boolean);
  const errors = required
    .filter(command => !commands.includes(command))
    .map(command => `verify script omits ${command}`);
  for (const command of required) {
    if (commands.filter(candidate => candidate === command).length > 1) errors.push(`verify script repeats ${command}`);
  }
  const preparedPackages = commands.indexOf("bun run check:packages:prepared");
  const localPlayback = commands.indexOf("bun run check:local-playback");
  if (preparedPackages >= 0 && localPlayback >= 0 && localPlayback < preparedPackages) {
    errors.push("verify script runs local playback before prepared package checks");
  }
  for (const command of supersededVerifyCommands) {
    if (commands.includes(command)) errors.push(`verify script uses superseded ${command}`);
  }
  return errors;
}

function archiveName(name: string, version: string): string {
  return `${name.replace(/^@/u, "").replaceAll("/", "-")}-${version}.tgz`;
}

function commands(run: string): readonly string[] {
  return run
    .split(/(?:&&|\|\||[;&|]|\r?\n)/u)
    .map(command => command.trim())
    .filter(Boolean);
}

function candidateArchiveOperand(command: string): string | undefined {
  const match = /\bnpm\s+publish\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/u.exec(command);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function isRegistryMutation(command: string): boolean {
  if (command.includes("--dry-run")) return false;
  return (
    /\b(?:npm|bun)\s+publish\b/u.test(command) ||
    /\bnpm\s+(?:deprecate|unpublish)\b/u.test(command) ||
    /\bnpm\s+dist-tag\s+(?:add|rm|remove)\b/u.test(command) ||
    /\bnpm\s+owner\s+(?:add|rm|remove)\b/u.test(command) ||
    /\bnpm\s+access\s+(?:grant|revoke|set)\b/u.test(command) ||
    /(?:^|\s)(?:(?:npm\s+exec|npx|bunx|bun)\s+(?:--[^\s]*\s+)*)?(?:@changesets\/cli|changeset)\s+(?:--[^\s]*\s+)*publish\b/u.test(
      command,
    )
  );
}

function authorizationCommand(packageName: string, archive: string): string {
  return `bun ./scripts/check-publish-authorization.ts --candidate-dir=../.candidate-bundle/.artifacts/release-candidate --package=${packageName} --archive=${archive}`;
}

function inspectCandidateAcquisition(workflow: WorkflowDocument, file: string): string[] {
  const errors: string[] = [];
  const steps = Object.values(workflow.jobs).flatMap(job => job.steps);
  const checkout = steps.find(step => step.uses?.startsWith("actions/checkout@"));
  if (checkout?.with?.path !== "DisTube") errors.push(`${file}: checkout must use workspace path DisTube`);

  const runs = steps.flatMap(step => (typeof step.run === "string" ? [step.run] : []));
  const runCommands = runs.flatMap(commands);
  const candidateAsset = "candidate-$" + "{AUTHORIZED_RELEASE_CANDIDATE_ID}.tar.gz";
  const download = runCommands.find(command => command.includes("gh release download"));
  if (!download?.includes("github.event.release.tag_name")) {
    errors.push(`${file}: missing release-asset download from the triggering release`);
  }
  if (!download?.includes(candidateAsset)) {
    errors.push(`${file}: release download must select the exact authorized candidate asset`);
  }
  if (!download?.includes('--repo "$' + '{{ github.repository }}"')) {
    errors.push(`${file}: release download must name the triggering repository`);
  }
  const extraction = runCommands.find(command => command.includes("extract-release-candidate.py"));
  if (
    !extraction?.includes("DisTube/scripts/extract-release-candidate.py") ||
    !extraction.includes(candidateAsset) ||
    !extraction.endsWith(".candidate-bundle")
  ) {
    errors.push(`${file}: candidate asset must use validated extraction into .candidate-bundle`);
  }
  if (runCommands.some(command => command.includes("tar -x"))) {
    errors.push(`${file}: candidate asset must not use direct tar extraction`);
  }
  if (!runCommands.some(command => command.includes(".candidate-bundle/.artifacts/release-candidate/manifest.json"))) {
    errors.push(`${file}: isolated candidate extraction must require manifest.json`);
  }
  return errors;
}

function inspectPublicationCommands(
  workflow: WorkflowDocument,
  file: string,
  corePackages: readonly { name: string; version: string }[],
): string[] {
  const errors: string[] = [];
  const expected = new Map(
    corePackages.map(item => [
      `../.candidate-bundle/.artifacts/release-candidate/core/archives/${archiveName(item.name, item.version)}`,
      item.name,
    ]),
  );
  const published = new Set<string>();

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    for (const [stepIndex, step] of job.steps.entries()) {
      if (typeof step.run !== "string") continue;
      const lines = commands(step.run);
      for (const [commandIndex, line] of lines.entries()) {
        if (!isRegistryMutation(line)) continue;
        for (const required of ["bun run check:release-inputs", "bun run verify"]) {
          if (!commandPrecedes(workflow, jobId, stepIndex, required)) {
            errors.push(`${file}: ${required} must finish before registry mutation ${line}`);
          }
        }

        const archive = candidateArchiveOperand(line);
        if (!archive) {
          errors.push(`${file}: forbidden registry mutation ${line}`);
          continue;
        }
        const packageName = expected.get(archive);
        if (!packageName) {
          errors.push(`${file}: npm publish must use an exact candidate core archive, found ${archive}`);
          continue;
        }
        if (published.has(packageName)) errors.push(`${file}: ${packageName} archive is published more than once`);
        published.add(packageName);
        if (lines[commandIndex - 1] !== authorizationCommand(packageName, archive)) {
          errors.push(`${file}: ${packageName} authorization must run directly before npm publish`);
        }
      }
    }
  }
  for (const packageName of corePackages.map(item => item.name)) {
    if (!published.has(packageName)) errors.push(`${file}: missing npm publish for ${packageName} candidate archive`);
  }
  return errors;
}

export function inspectReleaseScripts(scripts: Readonly<Record<string, string>>): string[] {
  const errors: string[] = [];
  for (const [name, script] of Object.entries(scripts)) {
    if (name === "release" || commands(script).some(isRegistryMutation)) {
      errors.push(`package.json: publishing script ${name} is forbidden`);
    }
  }
  return errors;
}

export function inspectWorkflow(content: string, bunVersion: string, policy: WorkflowPolicy): string[] {
  const errors: string[] = [];
  let workflow: WorkflowDocument;
  try {
    workflow = parseWorkflow(content);
  } catch (error) {
    return [`${policy.file}: invalid workflow: ${error instanceof Error ? error.message : String(error)}`];
  }
  const jobs = Object.entries(workflow.jobs);
  const steps = jobs.flatMap(([jobId, job]) => job.steps.map((step, stepIndex) => ({ jobId, step, stepIndex })));
  const bunPins = steps
    .filter(({ step }) => step.uses?.startsWith("oven-sh/setup-bun@"))
    .map(({ step }) => step.with?.["bun-version"]);
  if (!bunPins.some(version => String(version) === bunVersion))
    errors.push(`${policy.file}: expected Bun ${bunVersion}`);
  for (const command of policy.requiredCommands) {
    if (!steps.some(({ step }) => runContains(step, command))) errors.push(`${policy.file}: missing ${command}`);
  }
  const installs = steps.filter(({ step }) => runContains(step, "bun install"));
  if (
    installs.some(
      ({ jobId, stepIndex }) => !commandPrecedes(workflow, jobId, stepIndex, "bun run check:runtime", "bun install"),
    )
  ) {
    errors.push(`${policy.file}: runtime verification must precede dependency installation`);
  }
  if (policy.corePackages) {
    errors.push(...inspectCandidateAcquisition(workflow, policy.file));
    errors.push(...inspectPublicationCommands(workflow, policy.file, policy.corePackages));
    if (
      installs.some(
        ({ jobId, stepIndex }) =>
          !commandPrecedes(workflow, jobId, stepIndex, "bun run check:release-inputs", "bun install"),
      )
    ) {
      errors.push(`${policy.file}: committed release-input verification must precede installation`);
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8")) as {
    readonly packageManager?: string;
    readonly scripts?: Readonly<Record<string, string>>;
  };
  const bunVersion = manifest.packageManager?.replace(/^bun@/u, "");
  if (!bunVersion) throw new Error("package.json must pin packageManager to bun@<version>");
  const corePackages = [
    "packages/distube/package.json",
    "packages/discordjs/package.json",
    "packages/oceanic/package.json",
    "packages/eris/package.json",
  ].map(async path => {
    const packageManifest = JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8")) as {
      readonly name: string;
      readonly version: string;
    };
    return packageManifest;
  });
  const errors = [
    ...inspectVerifyScript(manifest.scripts?.verify ?? ""),
    ...inspectReleaseScripts(manifest.scripts ?? {}),
  ];
  const policies: readonly WorkflowPolicy[] = [
    { file: ".github/workflows/test.yml", requiredCommands: ["bun run check:runtime", "bun run verify"] },
    {
      file: ".github/workflows/publish.yml",
      requiredCommands: ["bun run check:runtime", "bun run check:release-inputs", "bun run verify"],
      corePackages: await Promise.all(corePackages),
    },
    { file: ".github/workflows/docs.yml", requiredCommands: ["bun run check:runtime", "bun run docs"] },
  ];
  for (const policy of policies) {
    const content = await readFile(resolve(repositoryRoot, policy.file), "utf8");
    errors.push(...inspectWorkflow(content, bunVersion, policy));
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write("Workflow parity verified: candidate archives are authorized immediately before publication.\n");
}

if (import.meta.main) await main();
