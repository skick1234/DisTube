import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

interface CompatibilityCase {
  readonly name: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

type CompatibilityMatrix = Readonly<Record<string, readonly CompatibilityCase[]>>;

const workspace = resolve(import.meta.dir, "..");
const packageDirectories = new Map([
  ["distube", "distube"],
  ["@distube/discordjs", "discordjs"],
  ["@distube/oceanic", "oceanic"],
  ["@distube/eris", "eris"],
]);

async function run(command: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed\n${stdout}${stderr}`);
  return stdout.trim();
}

async function pack(packageName: string, destination: string): Promise<string> {
  const directory = packageDirectories.get(packageName);
  if (!directory) throw new Error(`Unknown package ${packageName}`);
  const output = await run(
    ["bun", "pm", "pack", "--destination", destination, "--quiet", "--ignore-scripts"],
    resolve(workspace, "packages", directory),
  );
  return resolve(destination, basename(output.split(/\r?\n/u).at(-1) ?? ""));
}

const matrix = JSON.parse(await readFile(resolve(workspace, "adapter-compatibility.json"), "utf8")) as
  | CompatibilityMatrix
  | undefined;
if (!matrix || Object.keys(matrix).length === 0) throw new Error("Adapter compatibility matrix is empty");

await run(["bun", "run", "build"], workspace);
await run(["bun", "scripts/clean-source-declarations.ts"], workspace);
const temporary = await mkdtemp(join(tmpdir(), "distube-adapter-compatibility-"));
try {
  const coreArchive = await pack("distube", temporary);
  for (const [adapterName, cases] of Object.entries(matrix)) {
    if (cases.length < 2) throw new Error(`${adapterName}: expected lower and latest compatibility cases`);
    const adapterArchive = await pack(adapterName, temporary);
    for (const testCase of cases) {
      const testRoot = resolve(temporary, `${packageDirectories.get(adapterName)}-${testCase.name}`);
      await mkdir(testRoot, { recursive: true });
      await writeFile(
        resolve(testRoot, "package.json"),
        `${JSON.stringify(
          {
            private: true,
            type: "module",
            dependencies: {
              distube: `file:${coreArchive}`,
              [adapterName]: `file:${adapterArchive}`,
              ...testCase.dependencies,
            },
          },
          null,
          2,
        )}\n`,
      );
      await run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"], testRoot);
      await writeFile(
        resolve(testRoot, "smoke.mjs"),
        `import * as adapter from ${JSON.stringify(adapterName)}; if (!Object.keys(adapter).length) throw new Error("missing adapter exports");\n`,
      );
      await run(["node", "smoke.mjs"], testRoot);
      process.stdout.write(`${adapterName} ${testCase.name}: compatible\n`);
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
