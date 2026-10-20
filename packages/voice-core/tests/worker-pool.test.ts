import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Track } from "../src/track";
import { createMedia, type MediaFixtures, take } from "./support/media";
import { silentWav } from "./support/real";

let media: MediaFixtures;
beforeAll(async () => {
  media = await createMedia();
}, 30_000);
afterAll(() => media.cleanup());

function liveWorkers(): number {
  return (process.report.getReport() as { workers: unknown[] }).workers.length;
}

it("exits the playback worker 30 seconds after its last track closes", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const track = await Track.open(
      { kind: "file", path: media.opus },
      { volume: 100, chain: undefined },
      new AbortController().signal,
    );
    await take(track.packets, 5);
    await track.close();
    const afterClose = liveWorkers();

    vi.advanceTimersByTime(30_000);

    expect(afterClose).toBe(1);
    await vi.waitFor(() => expect(liveWorkers()).toBe(0));
  } finally {
    vi.useRealTimers();
  }
});

it("lets the process exit while a closed track's worker waits out its idle period", async () => {
  const dir = await mkdtemp(join(tmpdir(), "distube-voice-core-exit-"));
  try {
    const distube = new URL("../../distube/src/index.ts", import.meta.url).href;
    const track = new URL("../src/track.ts", import.meta.url).href;
    const audio = join(dir, "silence.wav");
    await writeFile(audio, silentWav());
    // Plain Node strips types but resolves neither extensionless relative imports nor the workspace alias.
    await writeFile(
      join(dir, "hooks.mjs"),
      `export async function resolve(specifier, context, next) {
        if (specifier === "distube") return next(${JSON.stringify(distube)}, context);
        try {
          return await next(specifier, context);
        } catch (error) {
          if (specifier.startsWith(".")) return next(specifier + ".ts", context);
          throw error;
        }
      }`,
    );
    await writeFile(
      join(dir, "child.mjs"),
      `import { register } from "node:module";
      register(${JSON.stringify(pathToFileURL(join(dir, "hooks.mjs")).href)});
      const { Track } = await import(${JSON.stringify(track)});
      const track = await Track.open(
        { kind: "file", path: ${JSON.stringify(audio)} },
        { volume: 100, chain: undefined },
        new AbortController().signal,
      );
      await track.close();
      console.log("closed");`,
    );

    const { stdout } = await promisify(execFile)(process.execPath, [join(dir, "child.mjs")], { timeout: 10_000 });

    expect(stdout).toContain("closed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);
