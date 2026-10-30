import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type * as WorkerThreads from "node:worker_threads";
import type { Diagnostic } from "distube/integrations";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Track } from "../src/track";
import { createMedia, type MediaFixtures, PLAIN, recorder, take } from "./support/media";
import { silentWav } from "./support/real";

const workerLoad = vi.hoisted(() => ({ readable: true }));
vi.mock("node:worker_threads", async importOriginal => {
  const actual = await importOriginal<typeof WorkerThreads>();
  class Worker extends actual.Worker {
    constructor(...args: ConstructorParameters<typeof actual.Worker>) {
      super(...args);
      const { performance } = this;
      Object.defineProperty(this, "performance", {
        get: () => {
          if (workerLoad.readable) return performance;
          throw Object.assign(new Error("worker.performance is not implemented"), { code: "ERR_NOT_IMPLEMENTED" });
        },
      });
    }
  }
  return { ...actual, Worker };
});

let media: MediaFixtures;
beforeAll(async () => {
  media = await createMedia();
}, 30_000);
afterAll(() => media.cleanup());

function liveWorkers(): number {
  return (process.report.getReport() as { workers: unknown[] }).workers.length;
}

function loads(reports: readonly Diagnostic[]): Diagnostic[] {
  return reports.filter(diagnostic => diagnostic.stage === "engine.worker.load");
}

function openFile(reporter = recorder()): Promise<Track> {
  return Track.open({ kind: "file", path: media.opus }, PLAIN, new AbortController().signal, reporter);
}

it("exits the playback worker 30 seconds after its last track closes", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const track = await openFile();
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
        ${JSON.stringify(PLAIN)},
        new AbortController().signal,
        { guildId: "guild", report: () => undefined },
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

it("reports one engine.worker.load per 30 s for a worker hosting a track, naming no guild", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const reporter = recorder();
    const track = await openFile(reporter);
    await take(track.packets, 5);

    vi.advanceTimersByTime(29_999);
    const early = loads(reporter.reports).length;
    vi.advanceTimersByTime(1);
    const first = loads(reporter.reports);
    vi.advanceTimersByTime(30_000);
    const second = loads(reporter.reports);
    await track.close();

    expect(early).toBe(0);
    expect(first).toEqual([
      {
        severity: expect.stringMatching(/^(debug|warning)$/u),
        stage: "engine.worker.load",
        message: expect.any(String),
        data: { threadId: expect.any(Number), tracks: 1, utilization: expect.any(Number) },
      },
    ]);
    expect(first[0]?.data?.utilization).toBeGreaterThanOrEqual(0);
    expect(first[0]?.data?.utilization).toBeLessThanOrEqual(1);
    expect(second).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

it("reports no engine.worker.load for a worker whose last track closed", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const reporter = recorder();
    const track = await openFile(reporter);
    await take(track.packets, 5);
    await track.close();

    vi.advanceTimersByTime(60_000);

    expect(loads(reporter.reports)).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

it("reports no engine.worker.load and still finishes the track where reading worker load throws", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  workerLoad.readable = false;
  try {
    const reporter = recorder();
    const track = await openFile(reporter);
    await take(track.packets, 5);

    vi.advanceTimersByTime(30_000);
    vi.useRealTimers();
    await take(track.packets, Number.POSITIVE_INFINITY);

    expect(await track.outcome).toEqual({ type: "ended" });
    expect(loads(reporter.reports)).toEqual([]);
    await track.close();
  } finally {
    workerLoad.readable = true;
    vi.useRealTimers();
  }
});
