import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { commandPrecedes, parseWorkflow, runContains } from "./workflow-structure";

export interface WorkflowPolicy {
  readonly file: string;
  readonly publishCommand?: string;
  readonly requiredCommands: readonly string[];
}

export const requiredVerifyCommands = [
  "bun run check:runtime",
  "bun run check",
  "bun run check:dependencies",
  "bun run type",
  "bun run test",
  "bun run build",
  "bun run check:circular",
  "bun run api-report",
  "bun run check:packages",
  "bun run check:adapter-compatibility",
  "bun run docs",
  "bun run test:critical-quality",
  "bun run check:audit",
  "bun run check:workflows",
] as const;

export function inspectVerifyScript(script: string, required = requiredVerifyCommands): string[] {
  return required.filter(command => !script.includes(command)).map(command => `verify script omits ${command}`);
}

export function inspectWorkflow(content: string, bunVersion: string, policy: WorkflowPolicy): string[] {
  const errors: string[] = [];
  let workflow: ReturnType<typeof parseWorkflow>;
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
  if (!bunPins.some(version => String(version) === bunVersion)) {
    errors.push(`${policy.file}: expected Bun ${bunVersion}`);
  }
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
  if (policy.publishCommand) {
    const publish = steps.find(({ step }) => runContains(step, policy.publishCommand ?? ""));
    if (!publish) errors.push(`${policy.file}: missing ${policy.publishCommand}`);
    else if (
      policy.requiredCommands.some(command => !commandPrecedes(workflow, publish.jobId, publish.stepIndex, command))
    ) {
      errors.push(`${policy.file}: publish command precedes required verification`);
    }
    if (
      !publish ||
      !commandPrecedes(workflow, publish.jobId, publish.stepIndex, "bun run check:publish-authorization")
    ) {
      errors.push(`${policy.file}: exact-candidate authorization must precede publication`);
    }
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
  const errors = inspectVerifyScript(manifest.scripts?.verify ?? "");
  const policies: readonly WorkflowPolicy[] = [
    { file: ".github/workflows/test.yml", requiredCommands: ["bun run check:runtime", "bun run verify"] },
    {
      file: ".github/workflows/publish.yml",
      requiredCommands: [
        "bun run check:runtime",
        "bun run check:release-inputs",
        "bun run verify",
        "bun run check:publish-authorization",
      ],
      publishCommand: "bun changeset publish",
    },
    { file: ".github/workflows/docs.yml", requiredCommands: ["bun run check:runtime", "bun run docs"] },
  ];
  for (const policy of policies) {
    const content = await readFile(resolve(repositoryRoot, policy.file), "utf8");
    errors.push(...inspectWorkflow(content, bunVersion, policy));
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write("Workflow parity verified: Bun pin and repository gates precede publication.\n");
}

if (import.meta.main) await main();
