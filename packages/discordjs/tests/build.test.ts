import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { bundle } from "../../voice-core/tests/support/bundle";

it("bundles voice-core into its build, worker included, without naming it", async () => {
  const output = await bundle(new URL("..", import.meta.url));

  expect([...output.keys()]).toEqual(expect.arrayContaining(["index.mjs", "index.d.mts", "worker.mjs"]));
  expect([...output].filter(([, text]) => text.includes("voice-core")).map(([file]) => file)).toEqual([]);
}, 60_000);

it("loads its built entry through require() by package name", () => {
  const loaded: Record<string, unknown> = createRequire(import.meta.url)("@distube/discordjs");

  expect(loaded.DiscordJSAdapter).toBeTypeOf("function");
});

const run = promisify(execFile);

it.each(["nodenext", "commonjs"])(
  "type-checks a CommonJS TypeScript bot that passes its discord.js Client under module %s",
  async module => {
    const require = createRequire(import.meta.url);
    const packageDir = fileURLToPath(new URL("..", import.meta.url));
    const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
    const dir = await mkdtemp(join(tmpdir(), "distube-discordjs-consumer-"));
    try {
      await mkdir(join(dir, "node_modules", "@distube"), { recursive: true });
      await symlink(packageDir, join(dir, "node_modules", "@distube", "discordjs"));
      await symlink(join(packageDir, "node_modules", "discord.js"), join(dir, "node_modules", "discord.js"));
      await writeFile(
        join(dir, "bot.cts"),
        'import { Client } from "discord.js";\nimport { DiscordJSAdapter } from "@distube/discordjs";\n' +
          "declare const client: Client;\nexport const adapter = new DiscordJSAdapter(client);\n",
      );
      await expect(
        run(process.execPath, [tsc, "--noEmit", "--strict", "--skipLibCheck", "--module", module, "bot.cts"], {
          cwd: dir,
        }),
      ).resolves.toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
