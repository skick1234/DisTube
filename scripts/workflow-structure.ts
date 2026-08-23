export interface WorkflowStep {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, unknown>>;
}

export interface WorkflowJob {
  readonly needs: readonly string[];
  readonly steps: readonly WorkflowStep[];
}

export interface WorkflowDocument {
  readonly jobs: Readonly<Record<string, WorkflowJob>>;
}

export function parseWorkflow(content: string): WorkflowDocument {
  const parsed = Bun.YAML.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || !("jobs" in parsed) || !parsed.jobs || typeof parsed.jobs !== "object") {
    throw new Error("workflow must define a jobs mapping");
  }
  const jobs: Record<string, WorkflowJob> = {};
  for (const [id, rawJob] of Object.entries(parsed.jobs as Record<string, unknown>)) {
    if (!rawJob || typeof rawJob !== "object") throw new Error(`workflow job ${id} must be an object`);
    const job = rawJob as Readonly<{ needs?: unknown; steps?: unknown }>;
    const needs = typeof job.needs === "string" ? [job.needs] : Array.isArray(job.needs) ? job.needs : [];
    if (!needs.every(value => typeof value === "string")) throw new Error(`workflow job ${id} has invalid needs`);
    if (!Array.isArray(job.steps)) throw new Error(`workflow job ${id} must define steps`);
    const steps = job.steps.map((step, index) => {
      if (!step || typeof step !== "object") throw new Error(`workflow job ${id} step ${index} must be an object`);
      return step as WorkflowStep;
    });
    jobs[id] = { needs, steps };
  }
  if (Object.keys(jobs).length === 0) throw new Error("workflow jobs mapping must not be empty");
  return { jobs };
}

/** True when some earlier step in the same job matches the predicate. */
export function stepPrecedes(
  workflow: WorkflowDocument,
  jobId: string,
  stepIndex: number,
  matches: (step: WorkflowStep) => boolean,
): boolean {
  const job = workflow.jobs[jobId];
  if (!job) return false;
  return job.steps.slice(0, stepIndex).some(step => matches(step));
}

export function runContains(step: WorkflowStep, command: string): boolean {
  return typeof step.run === "string" && step.run.split(/\r?\n/u).some(line => line.trim().includes(command));
}

export function transitiveNeeds(workflow: WorkflowDocument, jobId: string): ReadonlySet<string> {
  const reached = new Set<string>();
  const visit = (id: string): void => {
    const job = workflow.jobs[id];
    if (!job) throw new Error(`workflow job ${jobId} needs unknown job ${id}`);
    for (const dependency of job.needs) {
      if (reached.has(dependency)) continue;
      reached.add(dependency);
      visit(dependency);
    }
  };
  visit(jobId);
  return reached;
}

export function commandPrecedes(
  workflow: WorkflowDocument,
  jobId: string,
  stepIndex: number,
  command: string,
  beforeCommand?: string,
): boolean {
  const job = workflow.jobs[jobId];
  if (!job) return false;
  if (job.steps.slice(0, stepIndex).some(step => runContains(step, command))) return true;
  const currentLines = job.steps[stepIndex]?.run?.split(/\r?\n/u).map(line => line.trim()) ?? [];
  if (
    beforeCommand &&
    currentLines.findIndex(line => line.includes(command)) >= 0 &&
    currentLines.findIndex(line => line.includes(command)) <
      currentLines.findIndex(line => line.includes(beforeCommand))
  ) {
    return true;
  }
  return [...transitiveNeeds(workflow, jobId)].some(dependency =>
    workflow.jobs[dependency]?.steps.some(step => runContains(step, command)),
  );
}
