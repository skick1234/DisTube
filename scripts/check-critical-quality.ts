import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Metric = "branches" | "functions" | "lines" | "statements";
type Thresholds = Readonly<Record<Metric, number>>;

export interface CoveragePolicyInput {
  readonly packageName: string;
  readonly sourceFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly thresholds: Partial<Thresholds>;
  readonly floors: Thresholds;
}

export function inspectCoveragePolicy(input: CoveragePolicyInput): string[] {
  const errors: string[] = [];
  if (input.sourceFiles.length === 0) errors.push(`${input.packageName}: production source inventory is empty`);
  if (input.testFiles.length === 0) errors.push(`${input.packageName}: owning test inventory is empty`);
  if (input.include.length === 0) errors.push(`${input.packageName}: coverage include inventory is empty`);
  if (new Set(input.include).size !== input.include.length) {
    errors.push(`${input.packageName}: coverage include inventory contains duplicates`);
  }

  const includes = input.include.map(pattern => new Bun.Glob(pattern));
  const excludes = input.exclude.map(pattern => new Bun.Glob(pattern));
  for (const file of input.sourceFiles) {
    const owners = includes.filter(glob => glob.match(file)).length;
    if (owners === 0) errors.push(`${input.packageName}: coverage scope omits ${file}`);
    if (owners > 1) errors.push(`${input.packageName}: coverage scope selects ${file} ${owners} times`);
    if (excludes.some(glob => glob.match(file))) errors.push(`${input.packageName}: coverage excludes ${file}`);
  }

  for (const metric of ["statements", "branches", "functions", "lines"] as const) {
    const configured = input.thresholds[metric];
    const floor = input.floors[metric];
    if (typeof configured !== "number" || configured < floor) {
      errors.push(`${input.packageName}: ${metric} threshold ${String(configured)} is below required ${floor}`);
    }
  }
  return errors;
}

interface VitestCoverageConfig {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly thresholds?: Partial<Thresholds>;
}

async function inventory(pattern: string, cwd: string): Promise<string[]> {
  return Array.fromAsync(new Bun.Glob(pattern).scan({ cwd, onlyFiles: true })).then(files => files.sort());
}

async function verifyPackage(
  root: string,
  directory: string,
  packageName: string,
  floors: Thresholds,
): Promise<number> {
  const packageRoot = resolve(root, "packages", directory);
  const configModule = (await import(pathToFileURL(resolve(packageRoot, "vitest.config.ts")).href)) as {
    readonly default?: { readonly test?: { readonly coverage?: VitestCoverageConfig } };
  };
  const coverage = configModule.default?.test?.coverage;
  const sourceFiles = await inventory("src/**/*.ts", packageRoot);
  const testFiles = await inventory("tests/**/*.test.ts", packageRoot);
  const errors = inspectCoveragePolicy({
    packageName,
    sourceFiles,
    testFiles,
    include: coverage?.include ?? [],
    exclude: coverage?.exclude ?? [],
    thresholds: coverage?.thresholds ?? {},
    floors,
  });
  for (const test of testFiles) {
    if (!(await readFile(resolve(packageRoot, test), "utf8")).trim())
      errors.push(`${packageName}: owning test is empty: ${test}`);
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return sourceFiles.length;
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, "..");
  const packages = [
    ["distube", "distube", { statements: 90, branches: 85, functions: 90, lines: 90 }],
    ["voice-core", "@distube/voice-core", { statements: 85, branches: 80, functions: 85, lines: 90 }],
    ["discordjs", "@distube/discordjs", { statements: 85, branches: 80, functions: 85, lines: 90 }],
    ["oceanic", "@distube/oceanic", { statements: 85, branches: 80, functions: 85, lines: 90 }],
    ["eris", "@distube/eris", { statements: 85, branches: 80, functions: 85, lines: 90 }],
  ] as const;
  let sourceCount = 0;
  for (const [directory, packageName, floors] of packages) {
    sourceCount += await verifyPackage(root, directory, packageName, floors);
  }
  process.stdout.write(
    `Critical coverage inventory passed for ${sourceCount} production files in ${packages.length} packages.\n`,
  );
}
