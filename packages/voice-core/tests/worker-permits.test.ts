import type * as Os from "node:os";
import type { Diagnostic, Player, TrackEnd } from "distube/integrations";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FromWorker, PermitMessage, ToWorker } from "../src/protocol";
import { CHANNEL, gatewayAdapter, resetNative } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

interface FakeWorker {
  readonly posted: ToWorker[];
  readonly terminate: () => Promise<number>;
  send(message: FromWorker | PermitMessage): void;
  emit(event: string, ...args: unknown[]): boolean;
}

const workers = vi.hoisted((): FakeWorker[] => []);
const cpus = vi.hoisted(() => ({ count: 2 }));
const closes = vi.hoisted(() => ({ held: false }));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class Fake extends Emitter implements FakeWorker {
    readonly posted: ToWorker[] = [];
    readonly ref = vi.fn();
    readonly unref = vi.fn();
    readonly terminate = vi.fn(async () => 1);

    postMessage(message: ToWorker): void {
      this.posted.push(message);
      if (message.type === "close" && !closes.held)
        queueMicrotask(() => this.send({ type: "closed", track: message.track }));
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
const reports: Diagnostic[] = [];

beforeAll(() => vi.stubEnv("UV_THREADPOOL_SIZE", "3"));
afterAll(() => vi.unstubAllEnvs());
beforeEach(resetNative);
afterEach(async () => {
  vi.useRealTimers();
  closes.held = false;
  for (const worker of workers.splice(0)) worker.emit("exit", 0);
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup().catch(() => undefined);
  answered.clear();
  reports.length = 0;
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
  const player = await new DiscordVoiceEngine({
    opusComplexity: 10,
    bufferMs: 500,
    report: diagnostic => void reports.push(diagnostic),
  }).createPlayer(session, {
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

function posted<Type extends ToWorker["type"]>(type: Type): Extract<ToWorker, { type: Type }>[] {
  return workers
    .flatMap(worker => worker.posted)
    .filter((message): message is Extract<ToWorker, { type: Type }> => message.type === type);
}

function only<Message>(messages: readonly Message[]): Message {
  const [message] = messages;
  if (messages.length !== 1 || message === undefined) throw new Error(`Expected one message, got ${messages.length}`);
  return message;
}

function broadcast(message: FromWorker): void {
  for (const worker of workers) worker.send(message);
}

function causes(error: unknown): Error[] {
  const chain: Error[] = [];
  for (let current = error; current instanceof Error; current = current.cause) chain.push(current);
  return chain;
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

  it("fails the playing track with the crash, its stack and cause chain redacted, frees the worker's permits and plays the next track on a fresh worker", async () => {
    const player = await createPlayer();
    const { worker: lost, ended } = await playing(player);
    lost.send({ type: "acquire", permit: 1 });
    lost.send({ type: "acquire", permit: 2 });
    const crash = new Error("native crash reading /dev/null", {
      cause: new Error("libav assertion", { cause: new Error("av_read_frame returned -5") }),
    });

    lost.emit("error", crash);
    lost.emit("exit", 1);

    const chain = causes(
      await ended.then(
        () => undefined,
        (error: unknown) => error,
      ),
    );
    expect(chain.slice(-3).map(error => error.message)).toEqual([
      "native crash reading <redacted>",
      "libav assertion",
      "av_read_frame returned -5",
    ]);
    expect(chain.at(-3)?.stack).toBe(crash.stack?.replaceAll("/dev/null", "<redacted>"));
    const { worker: fresh } = await playing(player);
    fresh.send({ type: "acquire", permit: 1 });
    expect(fresh).not.toBe(lost);
    expect(granted(fresh)).toEqual([1]);
  });

  it("fails the playing track with the exit code of a worker that exits without an error", async () => {
    const { worker, ended } = await playing(await createPlayer());

    worker.emit("exit", 134);

    await expect(ended).rejects.toThrow("code 134");
  });

  it("settles release 5 s after a worker that never confirms the close, fails its other track, asks it to exit without terminating it and plays the next track on a fresh one", async () => {
    const player = await createPlayer();
    const { worker: stuck } = await playing(player);
    const { worker: shared, ended: neighbour } = await playing(await createPlayer());
    closes.held = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let released = false;
    void player.release().then(() => {
      released = true;
    });

    await vi.advanceTimersByTimeAsync(4_900);
    const beforeDeadline = released;
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();

    expect(beforeDeadline).toBe(false);
    expect(released).toBe(true);
    expect(shared).toBe(stuck);
    await expect(neighbour).rejects.toThrow("did not close a track within 5000 ms");
    expect(stuck.posted).toContainEqual({ type: "exit" });
    expect(stuck.terminate).not.toHaveBeenCalled();
    const { worker: fresh } = await playing(await createPlayer());
    expect(fresh).not.toBe(stuck);
  });

  it("rejects a filter change the lost worker never answered", async () => {
    const player = await createPlayer();
    const { worker } = await playing(player);
    const applying = player.setFilters([{ name: "bassboost" }]);
    await vi.waitFor(() => expect(worker.posted).toContainEqual(expect.objectContaining({ type: "filters" })));

    worker.emit("error", new Error("native crash"));

    await expect(applying).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("applies a filter change to a track that opened while the new chain was being checked", async () => {
    const player = await createPlayer();
    const { promise: started, resolve } = Promise.withResolvers<void>();
    void player.play({ kind: "file", path: "/dev/null" }, { signal: new AbortController().signal, onStart: resolve });
    const open = await vi.waitFor(() => only(posted("open")));
    const applying = player.setFilters([{ name: "bassboost" }]);
    const probe = await vi.waitFor(() => only(posted("probe")));

    broadcast({ type: "opened", track: open.track });
    await started;
    broadcast({ type: "settled", track: probe.track, request: 0 });

    const applied = await vi.waitFor(() => only(posted("filters")));
    broadcast({ type: "settled", track: open.track, request: applied.request });
    await applying;
    expect(open.chain).toBeUndefined();
    expect(applied).toMatchObject({ track: open.track, chain: "bass=g=10" });
    expect(posted("filters")).toHaveLength(1);
  });

  it("builds a chain checked while its replacement track waited for the old one to close once, on the replacement", async () => {
    const player = await createPlayer();
    await playing(player);
    closes.held = true;
    const { promise: started, resolve } = Promise.withResolvers<void>();
    void player.play({ kind: "file", path: "/dev/null" }, { signal: new AbortController().signal, onStart: resolve });
    const open = await vi.waitFor(() => only(posted("open").filter(message => !answered.has(message.track))));
    const close = await vi.waitFor(() => only(posted("close")));
    let committed = false;
    const applying = player.setFilters([{ name: "bassboost" }]).then(() => {
      committed = true;
    });
    const probe = await vi.waitFor(() => only(posted("probe")));

    broadcast({ type: "opened", track: open.track });
    broadcast({ type: "settled", track: probe.track, request: 0 });
    await vi.waitFor(() => expect(committed || posted("filters").length > 0).toBe(true));
    expect(posted("filters")).toEqual([]);
    await applying;
    broadcast({ type: "closed", track: close.track });

    const applied = await vi.waitFor(() => only(posted("filters")));
    broadcast({ type: "settled", track: open.track, request: applied.request });
    await started;
    expect(applied).toMatchObject({ track: open.track, chain: "bass=g=10" });
    expect(posted("filters")).toHaveLength(1);
  });
});

const failure = { name: "Error", message: "pipeline failure" };
const steps = (): unknown[] =>
  reports.filter(diagnostic => diagnostic.stage === "engine.track.failed").map(diagnostic => diagnostic.data?.step);

describe("engine.track.failed step", () => {
  it.each(["open", "worker"])("names %s for a worker failure at that stage before the track opened", async stage => {
    const player = await createPlayer();
    const ended = player.play(
      { kind: "file", path: "/dev/null" },
      { signal: new AbortController().signal, onStart: vi.fn() },
    );
    const open = await vi.waitFor(() => only(posted("open")));

    broadcast({ type: "failed", track: open.track, stage, error: failure });

    await expect(ended).rejects.toThrow("pipeline failure");
    expect(steps()).toEqual([stage]);
  });

  it("names worker for a worker that crashes before the track opened", async () => {
    const player = await createPlayer();
    const ended = player.play(
      { kind: "file", path: "/dev/null" },
      { signal: new AbortController().signal, onStart: vi.fn() },
    );
    await vi.waitFor(() => only(posted("open")));

    workers.at(-1)?.emit("error", new Error("native crash"));

    await expect(ended).rejects.toThrow("native crash");
    expect(steps()).toEqual(["worker"]);
  });

  it.each(["read", "decode", "seek", "worker"])(
    "names %s for a worker failure at that stage while playing",
    async stage => {
      const { worker, ended } = await playing(await createPlayer());
      const open = only(posted("open"));

      worker.send({ type: "failed", track: open.track, stage, error: failure });

      await expect(ended).rejects.toThrow("pipeline failure");
      expect(steps()).toEqual([stage]);
    },
  );
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
