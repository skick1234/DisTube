import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;
const IGNORED_DIRECTORIES = new Set([".git", ".turbo", "coverage", "dist", "node_modules", "reports"]);

export type TestInventoryComparison = Readonly<{
  duplicates: readonly string[];
  expected: readonly string[];
  omitted: readonly string[];
  selected: readonly string[];
  unexpected: readonly string[];
}>;

type PackageInventory = Readonly<{
  directory: string;
  name: string;
}>;

function normalizePath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//u, "");
}

function sortedUnique(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map(normalizePath))].sort();
}

export function compareTestInventory(
  expectedPaths: readonly string[],
  selectedPaths: readonly string[],
): TestInventoryComparison {
  const expected = sortedUnique(expectedPaths);
  const selected = selectedPaths.map(normalizePath).sort();
  const expectedSet = new Set(expected);
  const selectedSet = new Set(selected);
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const path of selected) {
    if (seen.has(path)) duplicates.add(path);
    seen.add(path);
  }

  return Object.freeze({
    duplicates: Object.freeze([...duplicates].sort()),
    expected: Object.freeze(expected),
    omitted: Object.freeze(expected.filter(path => !selectedSet.has(path))),
    selected: Object.freeze(selected),
    unexpected: Object.freeze([...selectedSet].filter(path => !expectedSet.has(path)).sort()),
  });
}

export function formatTestInventoryFailure(packageName: string, comparison: TestInventoryComparison): string {
  const failures: string[] = [];
  if (comparison.expected.length > 0 && comparison.selected.length === 0) {
    failures.push("selected zero maintained tests");
  }
  if (comparison.omitted.length > 0) failures.push(`omitted: ${comparison.omitted.join(", ")}`);
  if (comparison.duplicates.length > 0) failures.push(`selected more than once: ${comparison.duplicates.join(", ")}`);
  if (comparison.unexpected.length > 0)
    failures.push(`selected outside the maintained inventory: ${comparison.unexpected.join(", ")}`);
  return `${packageName} test inventory failed: ${failures.join("; ")}`;
}

export function assertTestInventory(packageName: string, comparison: TestInventoryComparison): void {
  if (comparison.omitted.length + comparison.duplicates.length + comparison.unexpected.length > 0) {
    throw new Error(formatTestInventoryFailure(packageName, comparison));
  }
}

export function discoverMaintainedTests(packageDirectory: string): readonly string[] {
  const discovered: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
        discovered.push(normalizePath(relative(packageDirectory, absolutePath)));
      }
    }
  }

  visit(packageDirectory);
  return sortedUnique(discovered);
}

export function discoverWorkspacePackages(workspaceRoot: string): readonly PackageInventory[] {
  const packagesDirectory = resolve(workspaceRoot, "packages");
  return readdirSync(packagesDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(resolve(packagesDirectory, entry.name, "package.json")))
    .map(entry => {
      const directory = resolve(packagesDirectory, entry.name);
      const manifest = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8")) as { name?: unknown };
      if (typeof manifest.name !== "string" || manifest.name.length === 0) {
        throw new Error(`Package at ${normalizePath(relative(workspaceRoot, directory))} has no valid name`);
      }
      return Object.freeze({ directory, name: manifest.name });
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}
