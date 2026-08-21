import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const temporaryDirectories: string[] = [];
const extractor = resolve(import.meta.dirname, "extract-release-candidate.py");

const archiveBuilder = `
import base64, json, sys, tarfile
entries = json.loads(sys.argv[2])
with tarfile.open(sys.argv[1], "w:gz") as archive:
    for entry in entries:
        info = tarfile.TarInfo(entry["name"])
        info.type = getattr(tarfile, entry.get("type", "REGTYPE"))
        info.linkname = entry.get("linkname", "")
        if info.type == tarfile.CHRTYPE:
            info.devmajor = 1
            info.devminor = 3
        data = base64.b64decode(entry.get("data", ""))
        info.size = len(data) if info.isfile() else 0
        archive.addfile(info, __import__("io").BytesIO(data) if info.isfile() else None)
`;

interface ArchiveEntry {
  readonly name: string;
  readonly type?: "REGTYPE" | "DIRTYPE" | "SYMTYPE" | "LNKTYPE" | "CHRTYPE";
  readonly linkname?: string;
  readonly data?: string;
}

async function run(...command: string[]): Promise<{ readonly code: number; readonly stderr: string }> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, stderr };
}

async function createArchive(root: string, entries: readonly ArchiveEntry[]): Promise<string> {
  const archive = resolve(root, "candidate.tar.gz");
  const encoded = entries.map(entry => ({
    ...entry,
    data: entry.data === undefined ? undefined : Buffer.from(entry.data).toString("base64"),
  }));
  const result = await run("python3", "-c", archiveBuilder, archive, JSON.stringify(encoded));
  expect(result).toEqual({ code: 0, stderr: "" });
  return archive;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "distube-candidate-extract-"));
  temporaryDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("release candidate bundle extraction", () => {
  test("extracts regular candidate evidence into a new isolated directory", async () => {
    const root = await fixture();
    const archive = await createArchive(root, [
      { name: ".artifacts/release-candidate/manifest.json", data: "{}\n" },
      { name: ".artifacts/release-candidate/core/archives/distube-6.0.0.tgz", data: "archive" },
    ]);
    const destination = resolve(root, "candidate-bundle");

    expect(await run("python3", extractor, archive, destination)).toEqual({ code: 0, stderr: "" });
    expect(await readFile(resolve(destination, ".artifacts/release-candidate/manifest.json"), "utf8")).toBe("{}\n");
    expect(
      await readFile(resolve(destination, ".artifacts/release-candidate/core/archives/distube-6.0.0.tgz"), "utf8"),
    ).toBe("archive");
  });

  test("rejects paths outside the candidate evidence directory", async () => {
    for (const name of [
      "DisTube/package.json",
      "../package.json",
      "/package.json",
      ".artifacts\\release-candidate\\manifest.json",
      ".artifacts/release-candidate/../package.json",
    ]) {
      const root = await fixture();
      const archive = await createArchive(root, [{ name, data: "changed" }]);
      const destination = resolve(root, "candidate-bundle");
      const result = await run("python3", extractor, archive, destination);
      expect(result.code).not.toBe(0);
      expect(await Bun.file(destination).exists()).toBe(false);
    }
  });

  test("rejects links, devices, duplicates, missing manifests, and existing destinations", async () => {
    for (const entry of [
      { name: ".artifacts/release-candidate/link", type: "SYMTYPE", linkname: "manifest.json" },
      { name: ".artifacts/release-candidate/link", type: "LNKTYPE", linkname: "manifest.json" },
      { name: ".artifacts/release-candidate/device", type: "CHRTYPE" },
    ] as const) {
      const root = await fixture();
      const archive = await createArchive(root, [
        { name: ".artifacts/release-candidate/manifest.json", data: "{}" },
        entry,
      ]);
      const result = await run("python3", extractor, archive, resolve(root, "candidate-bundle"));
      expect(result.code).not.toBe(0);
    }

    const duplicateRoot = await fixture();
    const duplicateArchive = await createArchive(duplicateRoot, [
      { name: ".artifacts/release-candidate/manifest.json", data: "{}" },
      { name: ".artifacts/release-candidate/manifest.json", data: "{}" },
    ]);
    expect(
      (await run("python3", extractor, duplicateArchive, resolve(duplicateRoot, "candidate-bundle"))).code,
    ).not.toBe(0);

    const missingRoot = await fixture();
    const missingArchive = await createArchive(missingRoot, [
      { name: ".artifacts/release-candidate/core/archive.tgz", data: "archive" },
    ]);
    expect((await run("python3", extractor, missingArchive, resolve(missingRoot, "candidate-bundle"))).code).not.toBe(
      0,
    );

    const existingRoot = await fixture();
    const existingArchive = await createArchive(existingRoot, [
      { name: ".artifacts/release-candidate/manifest.json", data: "{}" },
    ]);
    const existingDestination = resolve(existingRoot, "candidate-bundle");
    await Bun.write(existingDestination, "occupied");
    expect((await run("python3", extractor, existingArchive, existingDestination)).code).not.toBe(0);
  });
});
