import { resolve } from "node:path";
import { recordPreparedBuild } from "./prepared-build";

const root = resolve(import.meta.dirname, "..");
for (const directory of ["distube", "discordjs", "oceanic", "eris"]) {
  const child = Bun.spawn([process.execPath, "run", "--cwd", `packages/${directory}`, "build"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
}
await recordPreparedBuild(root);
process.stdout.write("Prepared build recorded for 4 publishable packages.\n");
