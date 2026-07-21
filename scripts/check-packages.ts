import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "..");
const packageDirectories = ["distube", "discordjs", "oceanic", "eris"] as const;

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

await run(["bun", "run", "build"], workspace);
for (const declaration of ["index.d.mts", "index.d.cts"]) {
  const content = await readFile(resolve(workspace, "packages/distube/dist", declaration), "utf8");
  if (/\b(?:from\s+["']eris|import\(["']eris)/u.test(content)) {
    throw new Error(`distube: native Eris type leaked into ${declaration}`);
  }
}
const temporary = await mkdtemp(join(tmpdir(), "distube-v6-packages-"));
try {
  const archives = new Map<string, string>();
  for (const directory of packageDirectories) {
    const root = resolve(workspace, "packages", directory);
    const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, unknown>;
    };
    const packed = await run(["bun", "pm", "pack", "--destination", temporary, "--quiet", "--ignore-scripts"], root);
    const archive = resolve(temporary, basename(packed.split(/\r?\n/u).at(-1) ?? ""));
    if (!(await Bun.file(archive).exists())) throw new Error(`${manifest.name}: archive was not created`);
    archives.set(manifest.name, archive);
    const entries = await readdir(root);
    for (const residue of entries.filter(entry => entry.endsWith(".tgz") || entry === ".artifacts")) {
      throw new Error(`${manifest.name}: package residue ${residue}`);
    }
    if (!manifest.exports?.["."]) throw new Error(`${manifest.name}: missing root export`);
  }

  const smoke = resolve(temporary, "smoke");
  await mkdir(smoke, { recursive: true });
  await Bun.write(
    resolve(smoke, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: Object.fromEntries([...archives].map(([name, archive]) => [name, `file:${archive}`])),
    }),
  );
  for (const [name, archive] of archives) {
    const target = resolve(smoke, "node_modules", ...name.split("/"));
    await mkdir(target, { recursive: true });
    await run(["tar", "-xzf", archive, "--strip-components=1", "-C", target], workspace);
  }
  await mkdir(resolve(smoke, "node_modules/@discordjs"), { recursive: true });
  for (const dependency of ["discord.js", "oceanic.js", "eris"]) {
    await symlink(resolve(workspace, "node_modules", dependency), resolve(smoke, "node_modules", dependency), "dir");
  }
  await symlink(
    resolve(workspace, "node_modules/@discordjs/voice"),
    resolve(smoke, "node_modules/@discordjs/voice"),
    "dir",
  );
  await writeFile(
    resolve(smoke, "smoke.mjs"),
    'import { DisTube } from "distube"; import { DiscordJSAdapter } from "@distube/discordjs"; import { OceanicAdapter } from "@distube/oceanic"; import { ErisAdapter } from "@distube/eris"; if (!DisTube || !DiscordJSAdapter || !OceanicAdapter || !ErisAdapter) throw new Error("missing public export");\n',
  );
  await run(["node", "smoke.mjs"], smoke);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write("Packed install smoke passed for all DisTube packages.\n");
