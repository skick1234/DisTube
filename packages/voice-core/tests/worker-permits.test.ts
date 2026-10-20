import { EventEmitter } from "node:events";
import type * as Os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FromWorker, PermitMessage } from "../src/pipeline-worker";
import type * as Pool from "../src/worker-pool";

class FakeWorker extends EventEmitter {
  readonly posted: unknown[] = [];
  readonly ref = vi.fn();
  readonly unref = vi.fn();

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  send(message: FromWorker | PermitMessage): void {
    this.emit("message", message);
  }

  granted(): unknown[] {
    return this.posted.filter(message => (message as { type?: string }).type === "granted");
  }
}

const workers = vi.hoisted((): FakeWorker[] => []);

vi.mock("node:worker_threads", () => ({
  Worker: vi.fn(function Worker() {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }),
}));
vi.mock("node:os", async importOriginal => ({
  ...(await importOriginal<typeof Os>()),
  availableParallelism: () => 2,
}));

async function opened(worker: FakeWorker, opening: Promise<unknown>): Promise<void> {
  await vi.waitFor(() => expect(worker.posted).toContainEqual(expect.objectContaining({ type: "open" })));
  const open = worker.posted.find(message => (message as { type?: string }).type === "open") as { track: number };
  worker.send({ type: "opened", track: open.track });
  await opening;
}

async function pool(): Promise<typeof Pool> {
  vi.resetModules();
  vi.stubEnv("UV_THREADPOOL_SIZE", "3");
  return await import("../src/worker-pool");
}

beforeEach(() => {
  workers.length = 0;
});

describe("worker pool", () => {
  it("keeps one libuv pool thread free by holding further native opens until a permit is released", async () => {
    const { attach } = await pool();
    attach(1, vi.fn());
    const [worker] = workers as [FakeWorker];

    worker.send({ type: "acquire", permit: 1 });
    worker.send({ type: "acquire", permit: 2 });
    worker.send({ type: "acquire", permit: 3 });
    const whileExhausted = worker.granted();
    worker.send({ type: "release", permit: 1 });

    expect(whileExhausted).toEqual([
      { type: "granted", permit: 1 },
      { type: "granted", permit: 2 },
    ]);
    expect(worker.granted()).toContainEqual({ type: "granted", permit: 3 });
  });

  it("drops a waiting permit that its open abandoned", async () => {
    const { attach } = await pool();
    attach(1, vi.fn());
    const [worker] = workers as [FakeWorker];
    worker.send({ type: "acquire", permit: 1 });
    worker.send({ type: "acquire", permit: 2 });
    worker.send({ type: "acquire", permit: 3 });

    worker.send({ type: "release", permit: 3 });
    worker.send({ type: "release", permit: 1 });

    expect(worker.granted()).not.toContainEqual({ type: "granted", permit: 3 });
  });

  it("fails every track of a crashed worker exactly once with its cause, frees its permits and starts a fresh worker", async () => {
    const { attach } = await pool();
    const first = vi.fn();
    const second = vi.fn();
    attach(1, first);
    attach(2, second);
    const [lost] = workers as [FakeWorker];
    lost.send({ type: "acquire", permit: 1 });
    lost.send({ type: "acquire", permit: 2 });

    lost.emit("error", new Error("native crash"));
    lost.emit("exit", 1);
    attach(3, vi.fn());
    const fresh = workers[1] as FakeWorker;
    fresh.send({ type: "acquire", permit: 1 });

    for (const [listener, track] of [
      [first, 1],
      [second, 2],
    ] as const) {
      expect(listener.mock.calls).toEqual([
        [{ type: "failed", track, stage: "worker", error: { name: "Error", message: "native crash" } }],
        [{ type: "closed", track }],
      ]);
    }
    expect(workers).toHaveLength(2);
    expect(fresh.granted()).toEqual([{ type: "granted", permit: 1 }]);
  });

  it("settles a Track on a lost worker and stops sending its controls there", async () => {
    await pool();
    const { Track } = await import("../src/track");
    const opening = Track.open(
      { kind: "file", path: "/dev/null" },
      { volume: 100, chain: undefined },
      new AbortController().signal,
    );
    const worker = await vi.waitFor(() => {
      const [spawned] = workers;
      if (!spawned) throw new Error("No worker yet");
      return spawned;
    });
    await opened(worker, opening);
    const track = await opening;

    worker.emit("error", new Error("native crash"));
    worker.emit("exit", 1);
    const sentBefore = worker.posted.length;
    await track.setFilters("volume=0.5");
    track.setVolume(50);

    await expect(track.outcome).resolves.toMatchObject({ type: "failed" });
    expect(worker.posted.slice(sentBefore)).toEqual([]);
  });

  it("rejects a filter change the lost worker never answered", async () => {
    await pool();
    const { Track } = await import("../src/track");
    const opening = Track.open(
      { kind: "file", path: "/dev/null" },
      { volume: 100, chain: undefined },
      new AbortController().signal,
    );
    const worker = await vi.waitFor(() => {
      const [spawned] = workers;
      if (!spawned) throw new Error("No worker yet");
      return spawned;
    });
    await opened(worker, opening);
    const track = await opening;
    const applying = track.setFilters("volume=0.5");
    await vi.waitFor(() => expect(worker.posted).toContainEqual(expect.objectContaining({ type: "filters" })));

    worker.emit("error", new Error("native crash"));

    await expect(applying).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
