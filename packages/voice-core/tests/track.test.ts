import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { ReaderPlaybackResource } from "distube/integrations";
import { AVERROR_DECODER_NOT_FOUND, AVERROR_INVALIDDATA } from "node-av";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { URL_READY_TIMEOUT_MS } from "../src/protocol";
import type { LocalPlaybackResource } from "../src/sources";
import { Track } from "../src/track";
import {
  bitrate,
  createMedia,
  fileReader,
  type MediaFixtures,
  PLAIN,
  peak,
  peaks,
  sourcePackets,
  take,
} from "./support/media";

vi.hoisted(() => vi.stubEnv("UV_THREADPOOL_SIZE", "4"));
const PERMITS = 3;

const NIGHTCORE = "asetrate=48000*1.25,aresample=48000,bass=g=5";

let media: MediaFixtures;
let opusPackets: Buffer[];
const servers: Server[] = [];
beforeAll(async () => {
  media = await createMedia();
  opusPackets = await sourcePackets(media.opus);
}, 30_000);
afterAll(async () => {
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  await media.cleanup();
  vi.unstubAllEnvs();
});

function causes(error: unknown): Error[] {
  const chain: Error[] = [];
  for (let current = error; current instanceof Error; current = current.cause) chain.push(current);
  return chain;
}

function open(
  resource: LocalPlaybackResource,
  settings = PLAIN,
  signal = new AbortController().signal,
): Promise<Track> {
  return Track.open(resource, settings, signal);
}

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function serveFile(path: string): Promise<string> {
  const body = await readFile(path);
  return `${await listen((_request, response) => response.end(body))}/audio`;
}

interface RedirectServer {
  readonly origin: string;
  readonly paths: string[];
  readonly headers: IncomingHttpHeaders[];
  readonly redirectSockets: Socket[];
}

/** `/hops/N` redirects N times to a media URL whose signature works once; `/ftp` redirects off HTTP. */
async function serveRedirects(path: string): Promise<RedirectServer> {
  const body = await readFile(path);
  const signatures = new Set<string>();
  const paths: string[] = [];
  const headers: IncomingHttpHeaders[] = [];
  const redirectSockets: Socket[] = [];
  let issued = 0;
  const redirect = (request: IncomingMessage, response: ServerResponse, location: string): void => {
    redirectSockets.push(request.socket);
    response.writeHead(302, { location });
    response.end("moved");
  };
  const origin = await listen((request, response) => {
    const { pathname, searchParams } = new URL(request.url ?? "/", "http://127.0.0.1");
    paths.push(pathname);
    headers.push(request.headers);
    const hops = Number(pathname.match(/^\/hops\/(\d+)$/u)?.[1]);
    if (hops > 1) redirect(request, response, `/hops/${hops - 1}`);
    else if (hops === 1) {
      issued += 1;
      signatures.add(String(issued));
      redirect(request, response, `/audio?sig=${issued}`);
    } else if (pathname === "/ftp") redirect(request, response, "ftp://127.0.0.1/audio");
    else if (signatures.delete(searchParams.get("sig") ?? "")) {
      response.writeHead(200, { "content-length": String(body.length) });
      response.end(body);
    } else {
      response.writeHead(403);
      response.end();
    }
  });
  return { origin, paths, headers, redirectSockets };
}

function failingRange(): Readable {
  return new Readable({
    read() {
      this.destroy(new Error("range read failed"));
    },
  });
}

async function drain(track: Track): Promise<Buffer[]> {
  return await take(track.packets, Number.POSITIVE_INFINITY);
}

/** Whether a packet is one 20 ms CELT fullband frame, which is what libopus emits in audio mode (RFC 6716). */
function celt20(packet: Buffer): boolean {
  const toc = packet[0] ?? 0;
  return toc >> 3 === 31 && (toc & 3) === 0;
}

describe("Track passthrough and transcode", () => {
  it("transcodes during a volume change and passes the source through again after it, from one input", async () => {
    const reader = await fileReader(media.opus);
    const track = await open(reader.resource);

    const before = await take(track.packets, 50);
    track.setVolume(50);
    const quieter = await take(track.packets, 100);
    track.setVolume(100);
    const after = await drain(track);

    expect(before.every((packet, index) => packet.equals(opusPackets[index] as Buffer))).toBe(true);
    expect(quieter.some(packet => !opusPackets.some(source => source.equals(packet)))).toBe(true);
    expect(Math.abs(before.length + quieter.length + after.length - opusPackets.length)).toBeLessThanOrEqual(2);
    const tail = opusPackets.slice(-100);
    expect(after.slice(-100).every((packet, index) => packet.equals(tail[index] as Buffer))).toBe(true);
    expect(reader.ranges[0]?.[0]).toBe(0);
    expect(reader.ranges.slice(1).every(([start], index) => start > (reader.ranges[index]?.[0] ?? 0))).toBe(true);
    await expect(track.outcome).resolves.toEqual({ type: "ended" });
    await track.close();
  });

  it("re-encodes Opus in 60 ms packets into 20 ms packets", async () => {
    const source = await sourcePackets(media.opus60);
    const track = await open({ kind: "file", path: media.opus60 });

    const sent = await drain(track);

    expect(sent.every(celt20)).toBe(true);
    expect(sent.length).toBeGreaterThanOrEqual(3 * source.length - 3);
    expect(sent.length).toBeLessThanOrEqual(3 * source.length + 3);
    await track.close();
  });

  it.each([
    [510_000, 160_000],
    [64_000, 64_000],
  ])("encodes 160 kbps AAC under a %i bps target at %i bps", async (target, expected) => {
    const reader = await fileReader(media.aac);
    const track = await open(reader.resource, { ...PLAIN, bitrate: target });

    const sent = await drain(track);

    expect(sent.length).toBeGreaterThanOrEqual(245);
    expect(sent.length).toBeLessThanOrEqual(255);
    expect(sent.every(celt20)).toBe(true);
    expect(bitrate(sent)).toBeGreaterThan(0.85 * expected);
    expect(bitrate(sent)).toBeLessThanOrEqual(1.05 * expected);
    await track.close();
  });

  it("encodes with the configured Opus complexity", async () => {
    const [simple, complex] = await Promise.all(
      [0, 10].map(async opusComplexity => {
        const track = await open({ kind: "file", path: media.aac }, { ...PLAIN, opusComplexity });
        const sent = await drain(track);
        await track.close();
        return sent;
      }),
    );

    expect(simple.length).toBe(complex.length);
    expect(simple.some((packet, index) => !packet.equals(complex[index] as Buffer))).toBe(true);
  });

  it("encodes at the target when neither the stream nor the container reports a bitrate", async () => {
    const track = await open(
      { kind: "timed", container: "webm", open: () => createReadStream(media.flac) },
      { ...PLAIN, bitrate: 192_000 },
    );

    const sent = await drain(track);

    expect(bitrate(sent)).toBeGreaterThan(0.85 * 192_000);
    expect(bitrate(sent)).toBeLessThanOrEqual(1.05 * 192_000);
    await track.close();
  });

  it.each([
    ["file", (): LocalPlaybackResource => ({ kind: "file", path: media.pcm })],
    ["stream", (): LocalPlaybackResource => ({ kind: "stream", stream: createReadStream(media.pcm) })],
  ])("plays PCM in 192,000-byte packets to the end from a %s", async (_kind, resource) => {
    const track = await open(resource());

    const sent = await drain(track);

    expect(sent.length).toBeGreaterThanOrEqual(249);
    expect(sent.length).toBeLessThanOrEqual(251);
    await expect(track.outcome).resolves.toEqual({ type: "ended" });
    await track.close();
  });
});

describe("Track position", () => {
  it("reports the source time of the last packet the platform played, not of the last one queued", async () => {
    const track = await open({ kind: "file", path: media.opus });
    let played = 0;
    track.setPlayedCounter(() => played);
    await take(track.packets, 100);
    const before = track.position;

    played = 30;
    const thirtieth = track.position;
    played = 80;

    expect(before).toBe(0);
    expect(thirtieth).toBeGreaterThan(0.56);
    expect(thirtieth).toBeLessThan(0.59);
    expect(track.position - thirtieth).toBeCloseTo(1, 2);
    await track.close();
  });
});

describe("Track threads", () => {
  it("keeps the event loop free while another track transcodes a heavy chain", async () => {
    const heavy = await open((await fileReader(media.hour)).resource, {
      ...PLAIN,
      chain: "anlmdn=s=0.001:p=0.1:r=0.3,anlmdn=s=0.001:p=0.1:r=0.3",
    });
    const light = await open({ kind: "file", path: media.opus });
    const consumption = new AbortController();
    let transcoded = 0;
    const consuming = (async () => {
      while (!consumption.signal.aborted) transcoded += (await take(heavy.packets, 5)).length;
    })();
    const delays: number[] = [];

    const until = performance.now() + 1000;
    while (performance.now() < until) {
      const start = performance.now();
      light.setVolume(delays.length % 2 === 0 ? 50 : 100);
      await new Promise(resolve => setTimeout(resolve, 0));
      delays.push(performance.now() - start);
    }
    consumption.abort();
    await consuming;

    expect(transcoded).toBeGreaterThan(0);
    expect(Math.max(...delays)).toBeLessThan(50);
    await Promise.all([heavy.close(), light.close()]);
  });
});

async function toneLoudness(volume: number): Promise<number> {
  const track = await open({ kind: "file", path: media.toneThenSilence }, { ...PLAIN, volume });
  const tone = await take(track.packets, 50);
  await track.close();
  return peak(tone.slice(2), media.opus);
}

describe("Track volume and filters", () => {
  it("amplifies a 0.61-scale tone to full scale at volume 300", async () => {
    const [plain, amplified] = [await toneLoudness(100), await toneLoudness(300)];

    expect(plain).toBeGreaterThan(0.55);
    expect(plain).toBeLessThan(0.7);
    expect(amplified).toBeGreaterThan(0.95);
  });

  it("reports source time under nightcore and keeps it when the filter is removed", async () => {
    const track = await open((await fileReader(media.hour)).resource, { ...PLAIN, chain: NIGHTCORE });

    await take(track.packets, 500);
    const sped = track.position;
    await track.setFilters(undefined);
    await take(track.packets, 50);

    expect(sped).toBeGreaterThan(12.4);
    expect(sped).toBeLessThan(12.8);
    expect(track.position).toBeGreaterThan(sped + 0.8);
    expect(track.position).toBeLessThan(sped + 1.3);
    await track.close();
  });

  it("rejects a chain libavfilter cannot build and keeps the committed one", async () => {
    const track = await open({ kind: "file", path: media.opus });

    const rejected = await track.setFilters("nonexistent_filter=1").then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejected).toMatchObject({ code: "INVALID_ARGUMENT", cause: expect.any(Error) });
    expect(String(((rejected as Error).cause as Error).stack)).not.toContain("node-av");
    const sent = await drain(track);

    expect(sent.every((packet, index) => packet.equals(opusPackets[index] as Buffer))).toBe(true);
    await track.close();
  });
});

describe("Track filter races", () => {
  it("keeps the committed chain running when a new one is rejected", async () => {
    const track = await open({ kind: "file", path: media.opus }, { ...PLAIN, chain: "volume=0" });
    await take(track.packets, 10);

    await expect(track.setFilters("nonexistent_filter=1")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const queued = track.packets.readableLength;
    const after = (await take(track.packets, queued + 52)).slice(queued + 2);

    expect(await peak(opusPackets.slice(10, 60), media.opus)).toBeGreaterThan(0.3);
    expect(after).toHaveLength(50);
    expect(await peak(after, media.opus)).toBeLessThan(0.001);
    await track.close();
  });

  it("settles filter changes in order while a seek is pending and plays the committed chain after it", async () => {
    const gate = new PassThrough();
    const track = await open({
      kind: "timed",
      container: "webm",
      open: seconds => (seconds === 0 ? createReadStream(media.hour) : gate),
    });
    await take(track.packets, 5);
    let seeked = false;
    const seeking = track.seek(30).then(() => {
      seeked = true;
    });
    await new Promise(resolve => setImmediate(resolve));

    await expect(track.setFilters("volume=0")).resolves.toBeUndefined();
    await expect(track.setFilters("nonexistent_filter=1")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const pendingAfterFilters = !seeked;
    createReadStream(media.hour).pipe(gate);
    await seeking;
    const queued = track.packets.readableLength;
    const after = (await take(track.packets, queued + 52)).slice(queued + 2);

    expect(pendingAfterFilters).toBe(true);
    expect(track.position).toBeGreaterThanOrEqual(30);
    expect(after).toHaveLength(50);
    expect(await peak(after, media.opus)).toBeLessThan(0.001);
    await track.close();
  });

  it("settles filter changes sent before close in order and ignores one sent after it", async () => {
    const track = await open({ kind: "file", path: media.opus });
    await take(track.packets, 5);

    const applied = track.setFilters(NIGHTCORE);
    const rejected = track.setFilters("nonexistent_filter=1");
    const closing = track.close();
    const late = track.setFilters(NIGHTCORE);

    await expect(applied).resolves.toBeUndefined();
    await expect(rejected).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(late).resolves.toBeUndefined();
    await closing;
    await expect(track.outcome).resolves.toEqual({ type: "closed" });
  });
});

function isTone(level: number): boolean {
  return level > 0.3;
}

function isSilent(level: number): boolean {
  return level < 0.02;
}

/** Packets after a seek to `target` in the pulses signal until audio switches at the next whole second; `heard` holds every packet so far. */
async function packetsToNextSecond(track: Track, heard: Buffer[], target: number): Promise<number> {
  await track.seek(target);
  const start = heard.length + track.packets.readableLength;
  heard.push(...(await take(track.packets, start - heard.length + 16)));
  const levels = (await peaks(heard, media.opus)).slice(start);
  const [landed, next] = Math.floor(target) % 2 === 0 ? [isTone, isSilent] : [isSilent, isTone];
  const switched = levels.findIndex((level, index) => index >= 2 && next(level));
  expect(levels.slice(2, switched).every(landed)).toBe(true);
  return switched;
}

describe("Track seek", () => {
  it("seeks to the start while the platform still plays the final packets, without ending", async () => {
    const track = await open({ kind: "file", path: media.opus });
    let played = 0;
    track.setPlayedCounter(() => played);
    let outcome: string | undefined;
    void track.outcome.then(settled => {
      outcome = settled.type;
    });
    await take(track.packets, opusPackets.length);
    played = opusPackets.length - 10;
    await new Promise(resolve => setTimeout(resolve, 100));

    await track.seek(0);

    expect(track.position).toBe(0);
    expect(await take(track.packets, 5)).toEqual(opusPackets.slice(0, 5));
    expect(outcome).toBeUndefined();
    await track.close();
  });

  it("starts the filter graph fresh, so an echo from before a seek does not play after it", async () => {
    const track = await open(
      { kind: "file", path: media.toneThenSilence },
      { ...PLAIN, chain: "aecho=0.8:0.9:1000:0.5" },
    );
    const tone = await take(track.packets, 50);

    await track.seek(6);
    const queued = track.packets.readableLength;
    const afterSeek = (await take(track.packets, queued + 52)).slice(queued + 2);

    expect(await peak(tone, media.opus)).toBeGreaterThan(0.3);
    expect(afterSeek).toHaveLength(50);
    expect(await peak(afterSeek, media.opus)).toBeLessThan(0.01);
    await track.close();
  });

  it("seeks late in an hour-long reader with a small fraction of the bytes before the target", async () => {
    const reader = await fileReader(media.hour);
    const track = await open(reader.resource);
    await take(track.packets, 10);
    const deliveredBefore = reader.delivered;

    await track.seek(48 * 60 + 2.5);
    await take(track.packets, 10);

    expect(track.position).toBeGreaterThanOrEqual(48 * 60 + 2.5);
    expect(track.position).toBeLessThan(48 * 60 + 3);
    expect(reader.delivered - deliveredBefore).toBeLessThan(0.1 * reader.resource.size * 0.8);
    await track.close();
  });

  it("opens a timed resource at the target and reports it after the switch", async () => {
    const opened: number[] = [];
    const track = await open({
      kind: "timed",
      container: "webm",
      open: seconds => {
        opened.push(seconds);
        return createReadStream(media.hour);
      },
    });
    await take(track.packets, 10);

    await track.seek(90);

    expect(opened).toEqual([0, 90]);
    expect(track.position).toBeGreaterThanOrEqual(90);
    expect(track.position).toBeLessThan(90.1);
    await track.close();
  });

  it("lands a containerless MP3 reader within one packet of where an exact PCM seek lands", async () => {
    const reader = await fileReader(media.pulses);
    const mp3 = await open(reader.resource);
    const pcm = await open({ kind: "file", path: media.pulsesPcm });
    const heardMp3 = await take(mp3.packets, 20);
    const heardPcm = await take(pcm.packets, 20);

    for (const target of [13.85, 3.85]) {
      const expected = await packetsToNextSecond(pcm, heardPcm, target);
      expect(expected).toBeGreaterThan(2);
      expect(Math.abs((await packetsToNextSecond(mp3, heardMp3, target)) - expected)).toBeLessThanOrEqual(1);
    }
    await Promise.all([mp3.close(), pcm.close()]);
  });

  it("plays on from the target when the input ends while a backward seek is pending", async () => {
    const bytes = await readFile(media.opus);
    const gates: { stream: PassThrough; start: number; end: number }[] = [];
    let gated = false;
    const reader = await fileReader(media.opus, (start, end) => {
      if (!gated) return undefined;
      const stream = new PassThrough();
      gates.push({ stream, start, end });
      return stream;
    });
    const track = await open(reader.resource);
    await take(track.packets, opusPackets.length - 11);
    gated = true;

    const seeking = track.seek(1);
    const draining = take(track.packets, 11);
    await vi.waitFor(() => expect(track.position).toBeGreaterThan(5.9));
    const settled = await Promise.race([
      track.outcome.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 50)),
    ]);
    gated = false;
    for (const gate of gates) gate.stream.end(bytes.subarray(gate.start, gate.end + 1));
    await seeking;
    const sent = [...(await draining), ...(await drain(track))];

    expect(settled).toBe(false);
    expect(sent.length).toBeGreaterThan(11 + 240);
    const tail = opusPackets.slice(-100);
    expect(sent.slice(-100).every((packet, index) => packet.equals(tail[index] as Buffer))).toBe(true);
    await expect(track.outcome).resolves.toEqual({ type: "ended" });
    await track.close();
  });

  it("ends normally when the input ends while a seek is pending and the seek fails", async () => {
    const gates: PassThrough[] = [];
    let gated = false;
    const reader = await fileReader(media.opus, () => {
      if (!gated) return undefined;
      const stream = new PassThrough();
      gates.push(stream);
      return stream;
    });
    const track = await open(reader.resource);
    await take(track.packets, opusPackets.length - 11);
    gated = true;

    const seeking = track.seek(1).then(
      () => undefined,
      (error: unknown) => error,
    );
    const draining = take(track.packets, Number.POSITIVE_INFINITY);
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    await vi.waitFor(() => expect(track.position).toBeGreaterThan(5.9));
    gates[0]?.destroy(new Error("range failed"));

    expect(await seeking).toBeInstanceOf(Error);
    expect(await draining).toHaveLength(11);
    await expect(track.outcome).resolves.toEqual({ type: "ended" });
    await track.close();
  });

  it("aborts the signal a timed resource opened with once that input closes", async () => {
    const signals: AbortSignal[] = [];
    const track = await open({
      kind: "timed",
      container: "webm",
      open: (_seconds, signal) => {
        signals.push(signal);
        return createReadStream(media.hour);
      },
    });
    await take(track.packets, 5);

    await track.seek(30);
    await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true));
    const current = signals[1]?.aborted;
    await track.close();

    expect(current).toBe(false);
    expect(signals[1]?.aborted).toBe(true);
  });

  it("aborts the signals handed to a reader once the seek retires their input, and the rest on close", async () => {
    const signals: AbortSignal[] = [];
    const base = (await fileReader(media.hour)).resource;
    const reader: ReaderPlaybackResource = {
      ...base,
      read: (start, end, signal) => {
        signals.push(signal);
        return base.read(start, end, signal);
      },
    };
    const track = await open(reader);
    await take(track.packets, 5);
    const first = [...signals];
    const live = first.some(signal => !signal.aborted);

    await track.seek(30 * 60);
    await vi.waitFor(() => expect(first.every(signal => signal.aborted)).toBe(true));
    const seeked = signals.slice(first.length);
    const liveAfterSeek = seeked.some(signal => !signal.aborted);
    await track.close();

    expect(live).toBe(true);
    expect(liveAfterSeek).toBe(true);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });

  it("keeps sending packets from the old input while a seek is pending", async () => {
    const gate = new PassThrough();
    const track = await open({
      kind: "timed",
      container: "webm",
      open: seconds => (seconds === 0 ? createReadStream(media.hour) : gate),
    });
    await take(track.packets, 5);

    let seeked = false;
    const seeking = track.seek(30).then(() => {
      seeked = true;
    });
    const during = await take(track.packets, 50);
    const pending = !seeked;
    createReadStream(media.hour).pipe(gate);
    await seeking;

    expect(during).toHaveLength(50);
    expect(pending).toBe(true);
    expect(track.position).toBeGreaterThanOrEqual(30);
    await track.close();
  });

  it("fences a seek stalled reading its header on close and joins every input", async () => {
    const stalls: PassThrough[] = [];
    let stalling = false;
    const reader = await fileReader(media.hour, () => {
      if (!stalling) return undefined;
      const stalled = new PassThrough();
      stalls.push(stalled);
      return stalled;
    });
    const track = await open(reader.resource);
    await take(track.packets, 5);
    stalling = true;

    const seeking = track.seek(40 * 60);
    const failure = seeking.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(stalls.length).toBeGreaterThan(0));
    await track.close();

    expect(await failure).toBeInstanceOf(Error);
    expect(reader.readables.every(readable => readable.destroyed)).toBe(true);
    await expect(track.outcome).resolves.toEqual({ type: "closed" });
  });

  it("rejects an overtaken seek ABORTED and lands on the later target", async () => {
    const track = await open({ kind: "file", path: media.hour });
    await take(track.packets, 5);
    const first = track.seek(40 * 60).then(
      () => undefined,
      (error: unknown) => error,
    );
    await track.seek(37);

    expect(await first).toMatchObject({ code: "ABORTED" });
    expect(track.position).toBeGreaterThanOrEqual(37);
    await track.close();
  });

  it("rejects a seek INVALID_STATE, not ABORTED, when the track fails before the seek lands", async () => {
    let trapped = false;
    let next = 0;
    const gates: { stream: PassThrough; start: number; end: number }[] = [];
    const reader = await fileReader(media.hour, (start, end) => {
      if (!trapped) {
        next = end + 1;
        return undefined;
      }
      if (start === next) return failingRange();
      const stream = new PassThrough();
      gates.push({ stream, start, end });
      return stream;
    });
    const track = await open(reader.resource);
    await take(track.packets, 5);
    trapped = true;
    const seeking = track.seek(30 * 60).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    void take(track.packets, Number.POSITIVE_INFINITY).catch(() => undefined);
    await expect(track.outcome).resolves.toMatchObject({ type: "failed" });
    trapped = false;
    for (const gate of gates) createReadStream(media.hour, { start: gate.start, end: gate.end }).pipe(gate.stream);

    expect(await seeking).toMatchObject({ code: "INVALID_STATE" });
    await track.close();
  });
});

describe("Track failures", () => {
  it.each(["reader", "file", "stream"] as const)(
    "rejects a %s that is not media with libav's error text and code as cause",
    async kind => {
      const garbage = Buffer.alloc(100_000, "not media ");
      const path = join(media.dir, "garbage.bin");
      await writeFile(path, garbage);
      const resource: LocalPlaybackResource =
        kind === "reader"
          ? {
              kind,
              size: garbage.length,
              container: "webm",
              read: (start, end) => Readable.from([garbage.subarray(start, end + 1)]),
            }
          : kind === "file"
            ? { kind, path }
            : { kind, stream: Readable.from([garbage]) };

      const failure = await open(resource).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("Decode failed during open");
      expect(causes(failure)).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Invalid data found when processing input"),
          code: AVERROR_INVALIDDATA,
        }),
      );
    },
  );

  it("rejects audio libav has no decoder for with the libav open error as cause", async () => {
    const failure = await open({ kind: "file", path: media.undecodable }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect((failure as Error).message).toContain("Decode failed during open");
    expect(causes(failure)).toContainEqual(expect.objectContaining({ code: AVERROR_DECODER_NOT_FOUND }));
  });
});

describe("Track input idle limits", () => {
  it("fails one-shot opens whose sources never write without holding up an open behind them", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const stalls = Array.from({ length: PERMITS }, () => new PassThrough());
      const reads = stalls.map(stall => vi.spyOn(stall, "read"));
      const failures = stalls.map(stall =>
        open({ kind: "timed", container: "webm", open: () => stall }).then(
          () => undefined,
          (error: unknown) => error,
        ),
      );
      await vi.waitFor(() => {
        for (const read of reads) expect(read.mock.calls).toContainEqual([]);
      });

      const track = await open({ kind: "file", path: media.opus });
      expect(await take(track.packets, 5)).toHaveLength(5);
      await track.close();
      await vi.advanceTimersByTimeAsync(URL_READY_TIMEOUT_MS);

      for (const failure of failures) {
        expect(causes(await failure).map(error => error.message)).toContainEqual(
          expect.stringContaining("stopped sending bytes"),
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out a one-shot source whose bytes keep arriving within the limit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const bytes = await readFile(media.opus);
      const stream = new PassThrough();
      stream.write(bytes.subarray(0, 64_000));
      const track = await open({ kind: "stream", stream });
      const draining = drain(track);

      for (let offset = 64_000; offset < bytes.length; offset += 32_000) {
        await vi.advanceTimersByTimeAsync(URL_READY_TIMEOUT_MS * 0.6);
        stream.write(bytes.subarray(offset, offset + 32_000));
      }
      stream.end();

      expect(await draining).toHaveLength(opusPackets.length);
      await expect(track.outcome).resolves.toEqual({ type: "ended" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out a one-shot source while its packets back up and the worker stops asking", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const bytes = await readFile(media.hour);
      let produced = 0;
      const stream = new Readable({
        read(size) {
          const chunk = bytes.subarray(produced, produced + size);
          produced += chunk.length;
          this.push(chunk);
        },
      });
      const track = await open({ kind: "stream", stream });
      await take(track.packets, 5);

      await vi.advanceTimersByTimeAsync(URL_READY_TIMEOUT_MS * 2);

      expect(await take(track.packets, 4000)).toHaveLength(4000);
      expect(produced).toBeGreaterThan(400_000);
      expect(track.settled).toBe(false);
      await track.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Track input contract", () => {
  it("fails an open whose reader window stops sending bytes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const stalled = new PassThrough();
      const reader = await fileReader(media.hour, () => stalled);
      const failure = open(reader.resource).then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(reader.readables).toContain(stalled));

      await vi.advanceTimersByTimeAsync(URL_READY_TIMEOUT_MS);

      expect(causes(await failure).map(error => error.message)).toContainEqual(
        expect.stringContaining("stopped sending bytes"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a reader whose range ends early with a safe cause", async () => {
    const reader = await fileReader(media.hour, start => {
      if (start > 0) return undefined;
      const short = new PassThrough();
      short.write(Buffer.alloc(100_000));
      setTimeout(() => short.end(), 50);
      return short;
    });

    const failure = await open(reader.resource).then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure?.message).toContain("Decode failed during open");
    expect(failure?.message).toContain("ended before its byte range");
  });
});

describe("Track URL redirects", () => {
  it.each([1, 5])(
    "plays a headerless URL from its target after %i redirects and closes each redirect socket",
    async hops => {
      const server = await serveRedirects(media.opus);
      const track = await open({ kind: "url", url: `${server.origin}/hops/${hops}` });

      expect(await take(track.packets, 10)).toHaveLength(10);
      expect(server.paths).toHaveLength(hops + 1);
      expect(server.paths.at(-1)).toBe("/audio");
      expect(server.redirectSockets).toHaveLength(hops);
      await vi.waitFor(() => expect(server.redirectSockets.every(socket => socket.destroyed)).toBe(true));
      await track.close();
    },
  );

  it("sends none of the headers untyped code attaches to a URL resource, through every redirect", async () => {
    const server = await serveRedirects(media.opus);
    const resource = {
      kind: "url",
      url: `${server.origin}/hops/2`,
      headers: { "X-Session": "private" },
    } as LocalPlaybackResource;

    const track = await open(resource);

    expect(await take(track.packets, 10)).toHaveLength(10);
    expect(server.paths).toEqual(["/hops/2", "/hops/1", "/audio"]);
    expect(server.headers.map(headers => headers["x-session"])).toEqual([undefined, undefined, undefined]);
    await track.close();
  });

  it.each([
    ["6 times", "/hops/6", "too many times", ["/hops/6", "/hops/5", "/hops/4", "/hops/3", "/hops/2", "/hops/1"]],
    ["to FTP", "/ftp", "non-HTTP location", ["/ftp"]],
  ])("rejects a URL redirected %s without requesting the media", async (_case, path, reason, paths) => {
    const server = await serveRedirects(media.opus);

    const failure: unknown = await open({ kind: "url", url: `${server.origin}${path}` }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ message: expect.stringContaining(reason) });
    expect(server.paths).toEqual(paths);
  });
});

describe("Track input bounds", () => {
  it.each(["stream", "url"] as const)(
    "plays a %s whose packets are larger than the read-ahead to its end",
    async kind => {
      const resource: LocalPlaybackResource =
        kind === "stream" ? { kind, stream: createReadStream(media.huge) } : { kind, url: await serveFile(media.huge) };
      const track = await open(resource);

      const packets = await drain(track);

      expect(await track.outcome).toEqual({ type: "ended" });
      expect(packets.length).toBeGreaterThanOrEqual(819);
    },
  );

  it("yields the first packet of a stream fed at 128 kbps within 1 s of its first bytes", async () => {
    const bytes = await readFile(media.opus);
    const stream = new PassThrough();
    const started = performance.now();
    let fed = 0;
    const feeder = setInterval(() => {
      stream.write(bytes.subarray(fed, fed + 1600));
      fed += 1600;
    }, 100);
    try {
      stream.write(bytes.subarray(0, 1600));
      fed = 1600;
      const track = await open({ kind: "stream", stream });
      const [first] = await take(track.packets, 1);
      const elapsed = performance.now() - started;

      expect(first).toEqual(opusPackets[0]);
      expect(elapsed).toBeLessThan(1000);
      await track.close();
    } finally {
      clearInterval(feeder);
    }
  });

  it("pauses a fast one-shot source instead of buffering it whole", async () => {
    const bytes = await readFile(media.hour);
    let produced = 0;
    const stream = new Readable({
      read(size) {
        const chunk = bytes.subarray(produced, produced + size);
        produced += chunk.length;
        this.push(chunk.length > 0 ? chunk : null);
      },
    });
    const track = await open({ kind: "stream", stream });

    await take(track.packets, 50);
    await new Promise(resolve => setImmediate(resolve));

    expect(produced).toBeLessThan(1024 * 1024);
    await track.close();
  });
});
