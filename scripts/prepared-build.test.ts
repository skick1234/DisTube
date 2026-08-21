import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  inspectPreparedBuild,
  type PreparedBuildStamp,
  preparedBuildInputFingerprint,
  preparedBuildOutputFingerprints,
} from "./prepared-build";

const valid: PreparedBuildStamp = {
  schemaVersion: 2,
  configuredBunVersion: "1.4.0",
  bunVersion: "1.4.0",
  bunRevision: "1.4.0+stable",
  inputFingerprint: "input",
  outputs: { "packages/distube/dist/index.mjs": "output" },
};

async function writeBuildFixture(root: string): Promise<void> {
  await mkdir(resolve(root, "scripts"), { recursive: true });
  await writeFile(resolve(root, "package.json"), '{"packageManager":"bun@1.4.0"}\n');
  await writeFile(resolve(root, "bun.lock"), "lock\n");
  await writeFile(resolve(root, "tsconfig.json"), '{"compilerOptions":{}}\n');
  await writeFile(resolve(root, "tsconfig.build.json"), '{"extends":"./tsconfig.json"}\n');
  await writeFile(resolve(root, "scripts/clean-source-declarations.ts"), "export {};\n");
  await writeFile(resolve(root, "scripts/sanitize-adapter-output.ts"), "export {};\n");
  for (const directory of ["distube", "discordjs", "oceanic", "eris"]) {
    const packageRoot = resolve(root, "packages", directory);
    await mkdir(resolve(packageRoot, "src"), { recursive: true });
    await mkdir(resolve(packageRoot, "dist"), { recursive: true });
    for (const file of ["index.mjs", "index.cjs", "index.d.mts", "index.d.cts"]) {
      await writeFile(resolve(packageRoot, "dist", file), "export {};\n");
    }
    await writeFile(resolve(packageRoot, "package.json"), `{"name":"${directory}"}\n`);
    await writeFile(resolve(packageRoot, "tsconfig.json"), "{}\n");
    await writeFile(resolve(packageRoot, "tsdown.config.ts"), "export default {};\n");
    await writeFile(resolve(packageRoot, "src/index.ts"), "export {};\n");
  }
  const voiceCore = resolve(root, "packages/voice-core");
  await mkdir(resolve(voiceCore, "src"), { recursive: true });
  await writeFile(resolve(voiceCore, "package.json"), '{"name":"@distube/voice-core"}\n');
  await writeFile(resolve(voiceCore, "tsconfig.json"), "{}\n");
  await writeFile(resolve(voiceCore, "src/player.ts"), "export const player = 1;\n");
}

describe("prepared build evidence", () => {
  test("accepts exact input, runtime, and output fingerprints", () => {
    expect(inspectPreparedBuild(valid, "input", "1.4.0", { "packages/distube/dist/index.mjs": "output" })).toEqual([]);
  });

  test("rejects missing, stale, wrong-runtime, canary, and incomplete evidence", () => {
    expect(inspectPreparedBuild(undefined, "input", "1.4.0", {})).toEqual(["prepared build stamp is missing"]);
    expect(
      inspectPreparedBuild({ ...valid, bunVersion: "1.3.14", inputFingerprint: "old" }, "input", "1.4.0", {
        "packages/distube/dist/index.mjs": "changed",
      }),
    ).toEqual([
      "prepared build expected Bun 1.4.0, observed 1.3.14",
      "prepared build inputs are stale",
      "prepared build output is stale: packages/distube/dist/index.mjs",
    ]);
    expect(
      inspectPreparedBuild({ ...valid, bunRevision: "1.4.0-canary.1+32e87032b" }, "input", "1.4.0", valid.outputs),
    ).toEqual(["prepared build expected stable Bun 1.4.0, observed canary revision 1.4.0-canary.1+32e87032b"]);
    expect(inspectPreparedBuild(valid, "input", "1.4.0", {})).toEqual([
      "prepared build output is missing: packages/distube/dist/index.mjs",
    ]);
  });

  test("invalidates evidence when a bundled voice-core input changes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "distube-prepared-build-"));
    try {
      await writeBuildFixture(root);
      const before = await preparedBuildInputFingerprint(root);
      await writeFile(resolve(root, "packages/voice-core/src/player.ts"), "export const player = 2;\n");
      const after = await preparedBuildInputFingerprint(root);

      expect(after).not.toBe(before);
      expect(inspectPreparedBuild({ ...valid, inputFingerprint: before }, after, "1.4.0", valid.outputs)).toContain(
        "prepared build inputs are stale",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("invalidates evidence when the shared adapter build config changes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "distube-prepared-build-"));
    try {
      await writeBuildFixture(root);
      const before = await preparedBuildInputFingerprint(root);
      await writeFile(
        resolve(root, "tsconfig.build.json"),
        '{"extends":"./tsconfig.json","compilerOptions":{"sourceMap":false}}\n',
      );
      const after = await preparedBuildInputFingerprint(root);

      expect(after).not.toBe(before);
      expect(inspectPreparedBuild({ ...valid, inputFingerprint: before }, after, "1.4.0", valid.outputs)).toContain(
        "prepared build inputs are stale",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fingerprints every emitted public output", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "distube-prepared-build-"));
    try {
      await writeBuildFixture(root);
      const before = await preparedBuildOutputFingerprints(root);
      const output = "packages/discordjs/dist/chunks/dist/index.mjs.map";
      await mkdir(resolve(root, "packages/discordjs/dist/chunks/dist"), { recursive: true });
      await writeFile(resolve(root, output), "{}\n");
      const after = await preparedBuildOutputFingerprints(root);

      expect(after[output]).toBeDefined();
      expect(inspectPreparedBuild({ ...valid, outputs: before }, "input", "1.4.0", after)).toContain(
        `prepared build output is stale: ${output}`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
