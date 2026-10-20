import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { MAX_DIAGNOSTIC_BYTES, MAX_ERROR_DEPTH, MAX_ERROR_NODES, WINDOW_BYTES } from "./input";
import type { FromWorker, PermitMessage, ToWorker, WorkerLimits } from "./pipeline-worker";

const IDLE_EXIT_MS = 30_000;
const POOL_SIZE = Math.max(1, Math.min(4, availableParallelism() - 1));
const PERMITS = Math.max(1, (Number(process.env.UV_THREADPOOL_SIZE) || 4) - 1);
const ENTRY = new URL(`./pipeline-worker.${import.meta.url.endsWith(".ts") ? "ts" : "mjs"}`, import.meta.url);
const LIMITS: WorkerLimits = {
  windowBytes: WINDOW_BYTES,
  errorDepth: MAX_ERROR_DEPTH,
  errorNodes: MAX_ERROR_NODES,
  errorText: MAX_DIAGNOSTIC_BYTES,
};

type Listener = (message: FromWorker) => void;

interface Thread {
  readonly worker: Worker;
  readonly tracks: Map<number, Listener>;
  readonly permits: Set<number>;
  idle?: NodeJS.Timeout;
}

export interface Lease {
  post(message: ToWorker, transfer?: readonly ArrayBuffer[]): void;
  detach(): void;
}

const threads: Thread[] = [];
let queued: { readonly thread: Thread; readonly permit: number }[] = [];
let available = PERMITS;

export function attach(track: number, listener: Listener): Lease {
  const thread = pick();
  clearTimeout(thread.idle);
  thread.idle = undefined;
  thread.tracks.set(track, listener);
  thread.worker.ref();
  return {
    post: (message, transfer = []) => thread.worker.postMessage(message, transfer),
    detach: () => {
      if (!thread.tracks.delete(track) || thread.tracks.size > 0 || !threads.includes(thread)) return;
      thread.worker.unref();
      thread.idle = setTimeout(() => retire(thread), IDLE_EXIT_MS).unref();
    },
  };
}

function pick(): Thread {
  let least: Thread | undefined;
  for (const thread of threads) if (!least || thread.tracks.size < least.tracks.size) least = thread;
  if (least && (least.tracks.size === 0 || threads.length >= POOL_SIZE)) return least;
  return spawn();
}

function spawn(): Thread {
  const worker = new Worker(ENTRY, { workerData: LIMITS });
  const thread: Thread = { worker, tracks: new Map(), permits: new Set() };
  worker.on("message", (message: FromWorker | PermitMessage) => {
    if (message.type === "acquire") acquire(thread, message.permit);
    else if (message.type === "release") release(thread, message.permit);
    else thread.tracks.get(message.track)?.(message);
  });
  worker.on("error", (error: Error) => lose(thread, error.message));
  worker.on("exit", () => lose(thread, "Playback worker exited"));
  threads.push(thread);
  return thread;
}

// node-av documents that Worker.terminate() during a native call can abort the process, so an idle worker exits itself.
function retire(thread: Thread): void {
  if (thread.tracks.size > 0) return;
  threads.splice(threads.indexOf(thread), 1);
  thread.worker.postMessage({ type: "exit" } satisfies ToWorker);
}

// Native open and pre-read seek park a libuv pool thread until main delivers bytes, maybe via dns.lookup on that pool.
function acquire(thread: Thread, permit: number): void {
  if (available === 0) {
    queued.push({ thread, permit });
    return;
  }
  available -= 1;
  thread.permits.add(permit);
  thread.worker.postMessage({ type: "granted", permit } satisfies ToWorker);
}

function release(thread: Thread, permit: number): void {
  if (thread.permits.delete(permit)) {
    available += 1;
    grantQueued();
    return;
  }
  queued = queued.filter(entry => entry.thread !== thread || entry.permit !== permit);
}

function grantQueued(): void {
  while (available > 0) {
    const next = queued.shift();
    if (!next) return;
    acquire(next.thread, next.permit);
  }
}

function lose(thread: Thread, message: string): void {
  const index = threads.indexOf(thread);
  if (index >= 0) threads.splice(index, 1);
  clearTimeout(thread.idle);
  queued = queued.filter(entry => entry.thread !== thread);
  available += thread.permits.size;
  thread.permits.clear();
  grantQueued();
  const tracks = [...thread.tracks];
  thread.tracks.clear();
  for (const [track, listener] of tracks) {
    listener({ type: "failed", track, stage: "worker", error: { name: "Error", message } });
    listener({ type: "closed", track });
  }
}
