import type * as Os from "node:os";
import type { Player, TrackEnd } from "distube/integrations";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FromWorker, PermitMessage, ToWorker } from "../src/protocol";
import { CHANNEL, gatewayAdapter, resetNative } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

interface FakeWorker {
  readonly posted: ToWorker[];
  send(message: FromWorker | PermitMessage): void;
  emit(event: string, ...args: unknown[]): boolean;
}

const workers = vi.hoisted((): FakeWorker[] => []);
const cpus = vi.hoisted(() => ({ count: 2 }));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class Fake extends Emitter implements FakeWorker {
    readonly posted: ToWorker[] = [];
    readonly ref = vi.fn();
    readonly unref = vi.fn();

    postMessage(message: ToWorker): void {
      this.posted.push(message);
      if (message.type === "close") queueMicrotask(() => this.send({ type: "closed", track: message.track }));
    }

    send(message: FromWorker | PermitMessage): void {
      this.emit("message", message);
    }
  }
  return {
    Worker: vi.fn(function Worker() {
      const worker = new Fake();
      workers.push(worker);
      return worker;
    }),
  };
});
vi.mock("node:os", async importOriginal => ({
  ...(await importOriginal<typeof Os>()),
  availableParallelism: () => cpus.count,
}));

const cleanups: (() => Promise<unknown>)[] = [];
const answered = new Set<number>();

beforeAll(() => vi.stubEnv("UV_THREADPOOL_SIZE", "3"));
afterAll(() => vi.unstubAllEnvs());
beforeEach(resetNative);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup().catch(() => undefined);
  for (const worker of workers.splice(0)) worker.emit("exit", 0);
  answered.clear();
});

async function createPlayer(): Promise<Player> {
  const { DiscordVoiceEngine, DiscordVoiceSession } = await import("../src");
  const session = await DiscordVoiceSession.connect({
    guildId: "guild",
    channelId: CHANNEL,
    clientUserId: "bot",
    adapterCreator: gatewayAdapter().creator,
    selfDeaf: true,
    selfMute: false,
    timeoutMs: 50,
    channelBitrate: () => 64_000,
    preflight: () => undefined,
  });
  const player = await new DiscordVoiceEngine({ opusComplexity: 10, bufferMs: 500 }).createPlayer(session, {
    onClosed: () => undefined,
  });
  cleanups.push(
    () => session.release(),
    () => player.release(),
  );
  return player;
}

/** Plays a file on `player` and answers its open from the newest worker, as the real worker would. */
async function playing(player: Player): Promise<{ worker: FakeWorker; ended: Promise<TrackEnd> }> {
  const { promise: started, resolve } = Promise.withResolvers<void>();
  const ended = player.play(
    { kind: "file", path: "/dev/null" },
    { signal: new AbortController().signal, onStart: resolve },
  );
  void ended.catch(() => undefined);
  const worker = await vi.waitFor(() => {
    const newest = workers.at(-1);
    const open = newest?.posted.find(message => message.type === "open" && !answered.has(message.track));
    if (!newest || open?.type !== "open") throw new Error("No open posted yet");
    answered.add(open.track);
    newest.send({ type: "opened", track: open.track });
    return newest;
  });
  await started;
  return { worker, ended };
}

function granted(worker: FakeWorker): number[] {
  return worker.posted.flatMap(message => (message.type === "granted" ? [message.permit] : []));
}

describe("playback worker pool", () => {
  it("keeps one libuv pool thread free by holding a third native open until a permit is released", async () => {
    const { worker } = await playing(await createPlayer());

    worker.send({ type: "acquire", permit: 1 });
    worker.send({ type: "acquire", permit: 2 });
    worker.send({ type: "acquire", permit: 3 });
    const whileExhausted = granted(worker);
    worker.send({ type: "release", permit: 1 });

    expect(whileExhausted).toEqual([1, 2]);
    expect(granted(worker)).toEqual([1, 2, 3]);
  });

  it("drops a waiting permit that its open abandoned", async () => {
    const { worker } = await playing(await createPlayer());
    worker.send({ type: "acquire", permit: 1 });
    worker.send({ type: "acquire", permit: 2 });
    worker.send({ type: "acquire", permit: 3 });

    worker.send({ type: "release", permit: 3 });
    worker.send({ type: "release", permit: 1 });

    expect(granted(worker)).toEqual([1, 2]);
  });

  it("fails the playing track with the crash cause, frees the worker's permits and plays the next track on a fresh worker", async () => {
    const player = await createPlayer();
    const { worker: lost, ended } = await playing(player);
    lost.send({ type: "acquire", permit: 1 });
    lost.send({ type: "acquire", permit: 2 });

    lost.emit("error", new Error("native crash"));
    lost.emit("exit", 1);

    await expect(ended).rejects.toThrow("native crash");
    const { worker: fresh } = await playing(player);
    fresh.send({ type: "acquire", permit: 1 });
    expect(fresh).not.toBe(lost);
    expect(granted(fresh)).toEqual([1]);
  });

  it("rejects a filter change the lost worker never answered", async () => {
    const player = await createPlayer();
    const { worker } = await playing(player);
    const applying = player.setFilters([{ name: "bassboost" }]);
    await vi.waitFor(() => expect(worker.posted).toContainEqual(expect.objectContaining({ type: "filters" })));

    worker.emit("error", new Error("native crash"));

    await expect(applying).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("open permits with UV_THREADPOOL_SIZE unset", () => {
  const versions = process.versions;
  beforeEach(() => {
    vi.stubEnv("UV_THREADPOOL_SIZE", undefined);
    vi.resetModules();
    cpus.count = 8;
  });
  afterEach(() => {
    Object.defineProperty(process, "versions", { value: versions });
    cpus.count = 2;
  });

  it.each([
    { runtime: "Node", bun: undefined, permits: 3 },
    { runtime: "Bun", bun: "1.4.4", permits: 7 },
  ])("grants $permits opens at once on $runtime with 8 CPUs", async ({ bun, permits }) => {
    if (bun) Object.defineProperty(process, "versions", { value: { ...versions, bun } });
    const { worker } = await playing(await createPlayer());

    for (let permit = 1; permit <= permits + 1; permit++) worker.send({ type: "acquire", permit });

    expect(granted(worker)).toEqual(Array.from({ length: permits }, (_, index) => index + 1));
  });
});
