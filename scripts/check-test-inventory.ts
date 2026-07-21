import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertTestInventory,
  compareTestInventory,
  discoverMaintainedTests,
  discoverWorkspacePackages,
} from "./test-inventory";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

function normalizePath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//u, "");
}

function selectedTests(packageDirectory: string): readonly string[] {
  const result = spawnSync(process.execPath, ["x", "vitest", "list", "--filesOnly", "--root", packageDirectory], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  const output = result.stdout
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean)
    .map(path => {
      const absolutePath = resolve(packageDirectory, path);
      return normalizePath(relative(packageDirectory, absolutePath));
    });

  if (result.status !== 0 && output.length > 0) {
    throw new Error(result.stderr.trim() || `Vitest collection failed for ${packageDirectory}`);
  }
  return output;
}

function selectedPackageArguments(): readonly string[] {
  const selected: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--package") continue;
    const value = process.argv[index + 1];
    if (!value) throw new Error("--package requires a workspace-relative directory");
    selected.push(value);
    index += 1;
  }
  return selected;
}

const requestedPackages = selectedPackageArguments();
const packages = discoverWorkspacePackages(workspaceRoot).filter(pkg => {
  if (requestedPackages.length === 0) return true;
  const relativeDirectory = normalizePath(relative(workspaceRoot, pkg.directory));
  return requestedPackages.includes(relativeDirectory);
});

if (requestedPackages.length > 0 && packages.length !== requestedPackages.length) {
  throw new Error(`Unknown package selection: ${requestedPackages.join(", ")}`);
}

const checked: string[] = [];
for (const pkg of packages) {
  const expected = discoverMaintainedTests(pkg.directory);
  if (expected.length === 0) continue;
  const comparison = compareTestInventory(expected, selectedTests(pkg.directory));
  assertTestInventory(pkg.name, comparison);
  checked.push(`${pkg.name} (${expected.length} ${expected.length === 1 ? "file" : "files"})`);
}

if (checked.length === 0) throw new Error("The selected workspace scope contains no maintained tests");
process.stdout.write(`Test inventory valid: ${checked.join(", ")}\n`);
