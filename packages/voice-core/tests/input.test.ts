import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import * as NodeHttp from "node:http";
import type { AddressInfo } from "node:net";
import { basename } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { URL_READY_TIMEOUT_MS } from "../src/protocol";
import type { LocalPlaybackResource } from "../src/sources";
import { Track } from "../src/track";
import { createMedia, type MediaFixtures, PLAIN, take } from "./support/media";
import { silentWav } from "./support/real";

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:http", async importOriginal => ({
  ...(await importOriginal<typeof NodeHttp>()),
  request: http.request,
}));
vi.mock("node:https", () => ({ request: http.request }));

type FakeRequest = EventEmitter & { destroy: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
type FakeResponse = PassThrough & { statusCode: number; headers: Record<string, string> };

interface Sent {
  readonly url: URL;
  readonly request: FakeRequest;
  readonly response: FakeResponse;
}

let media: MediaFixtures;
let body: Buffer;
let sent: Sent[];
/** Answers every request from `body`; `false` withholds the response. */
let answer: (request: Sent) => boolean | undefined;

beforeAll(async () => {
  media = await createMedia();
  body = await readFile(media.hour);
}, 30_000);
afterAll(() => media.cleanup());

beforeEach(() => {
  sent = [];
  answer = ({ response }) => {
    response.end(body);
    return true;
  };
  http.request.mockImplementation((url: URL, _options: unknown, callback: (response: FakeResponse) => void) => {
    const request: FakeRequest = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
    const response: FakeResponse = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
    const entry = { url, request, response };
    sent.push(entry);
    request.end.mockImplementation(() => {
      if (answer(entry) !== false) callback(response);
    });
    return request;
  });
});
afterEach(() => vi.useRealTimers());

function open(resource: LocalPlaybackResource, signal = new AbortController().signal): Promise<Track> {
  return Track.open(resource, PLAIN, signal);
}

function causes(error: Error): Error[] {
  const chain: Error[] = [];
  for (let current: unknown = error; current instanceof Error; current = current.cause) chain.push(current);
  return chain;
}

async function failureOf(work: Promise<unknown>): Promise<Error> {
  return await work.then(
    () => {
      throw new Error("Expected the operation to fail");
    },
    (error: unknown) => error as Error,
  );
}

describe("controlled URL input", () => {
  it("plays a URL whose server ignores the range from one request and refuses to seek it", async () => {
    const track = await open({ kind: "url", url: "https://example.test/live" });
    await take(track.packets, 10);

    await expect(track.seek(5)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(sent).toHaveLength(1);
    await track.close();
    expect(sent[0]?.response.destroyed).toBe(true);
  });

  it("fails after start with its own URL redacted from the cause", async () => {
    const url = "https://example.test/live?signature=private-signature";
    answer = ({ response }) => {
      response.write(body.subarray(0, 400_000));
      return true;
    };
    const track = await open({ kind: "url", url });
    await take(track.packets, 5);

    sent[0]?.response.destroy(new Error(`reset while reading ${url}`));
    await take(track.packets, Number.POSITIVE_INFINITY);
    const outcome = await track.outcome;

    const error = outcome.type === "failed" ? outcome.error : new Error("Expected a failed outcome");
    const text = JSON.stringify(causes(error).map(cause => cause.message));
    expect(error.message).toContain("Decode failed during read");
    expect(error.message).toContain("<redacted>");
    expect(text).not.toContain("private-signature");
    await track.close();
  });

  it.each([403, 500])("rejects HTTP %i", async status => {
    answer = ({ response }) => {
      response.statusCode = status;
      return true;
    };

    const failure = await failureOf(open({ kind: "url", url: "https://example.test" }));

    expect(failure.message).toContain("non-success status");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.request.destroy).toHaveBeenCalledOnce();
    expect(sent[0]?.response.destroyed).toBe(true);
  });

  it("rejects a DASH manifest", async () => {
    answer = ({ response }) => {
      response.headers["content-type"] = "application/dash+xml";
      return true;
    };

    await expect(open({ kind: "url", url: "https://example.test" })).rejects.toThrow("manifest");
  });

  it("bounds readiness when the response never arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    answer = () => false;

    const pending = open({ kind: "url", url: "https://example.test" });
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(URL_READY_TIMEOUT_MS);

    await assertion;
  });

  it("aborts pending readiness and destroys the request", async () => {
    answer = () => false;
    const controller = new AbortController();
    const pending = open({ kind: "url", url: "https://example.test" }, controller.signal);
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(sent[0]?.request.destroy).toHaveBeenCalled();
  });

  it("keeps a safe cause and code when the request fails before headers", async () => {
    const url = "https://example.test/audio?token=private-url";
    answer = ({ request }) => {
      request.emit("error", Object.assign(new Error(`GET ${url}`), { code: "ECONNRESET" }));
      return false;
    };

    const failure = await failureOf(open({ kind: "url", url }));

    const chain = causes(failure);
    expect(failure.message).toContain("Playback URL request failed");
    expect(chain.some(error => Reflect.get(error, "code") === "ECONNRESET")).toBe(true);
    expect(JSON.stringify(chain.map(error => error.message))).not.toContain("private-url");
  });

  it("clears readiness work after a synchronous request failure", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    http.request.mockImplementation(() => {
      throw new Error("private URL");
    });

    await expect(open({ kind: "url", url: "https://example.test" })).rejects.toThrow("Playback URL request failed");
    expect(vi.getTimerCount()).toBe(0);
  });
});

type Route = (response: NodeHttp.ServerResponse, request: NodeHttp.IncomingMessage) => void;

interface Origin {
  readonly url: string;
  readonly requests: { readonly path: string; readonly range?: string; answered: boolean; closed: boolean }[];
  paths(): string[];
  close(): Promise<void>;
}

async function serve(routes: (url: string) => Record<string, Route>): Promise<Origin> {
  const requests: Origin["requests"] = [];
  let table = new Map<string, Route>();
  const server = NodeHttp.createServer((request, response) => {
    const entry = { path: request.url ?? "", range: request.headers.range, answered: false, closed: false };
    requests.push(entry);
    response.on("finish", () => (entry.answered = true));
    response.on("close", () => (entry.closed = true));
    const route = table.get(entry.path);
    if (typeof route === "function") route(response, request);
    else response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  table = new Map(Object.entries(routes(url)));
  return {
    url,
    requests,
    paths: () => requests.map(request => request.path),
    close: () => {
      server.closeAllConnections();
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}

function playlist(segments: readonly string[]): Route {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:1", "#EXT-X-MEDIA-SEQUENCE:0"];
  for (const segment of segments) lines.push("#EXTINF:1.0,", segment);
  lines.push("#EXT-X-ENDLIST", "");
  return response => response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" }).end(lines.join("\n"));
}

function bytes(content: Buffer | string): Route {
  return response => response.writeHead(200, { "content-type": "video/mp2t" }).end(content);
}

/** Answers `bytes=<start>-` with 206 and at most `cap` bytes while `serves(start)` holds, otherwise 200 and the whole body. */
function ranged(content: Buffer, serves: (start: number) => boolean = () => true, cap = content.length): Route {
  return (response, request) => {
    const start = Number(/^bytes=(\d+)-$/.exec(request.headers.range ?? "")?.[1]);
    if (!Number.isInteger(start) || !serves(start)) {
      response.writeHead(200).end(content);
      return;
    }
    if (start >= content.length) {
      response.writeHead(416).end();
      return;
    }
    const end = Math.min(content.length, start + cap) - 1;
    response.writeHead(206, { "content-range": `bytes ${start}-${end}/${content.length}` });
    response.end(content.subarray(start, end + 1));
  };
}

describe("range-read URLs", () => {
  let hour: Buffer;
  let origin: Origin | undefined;

  beforeAll(async () => {
    hour = await readFile(media.hour);
  });
  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeHttp>("node:http");
    http.request.mockImplementation(actual.request);
  });
  afterEach(() => origin?.close());

  it("plays a WAV to the end from one request", async () => {
    origin = await serve(() => ({ "/a.wav": ranged(Buffer.from(silentWav())) }));

    const track = await open({ kind: "url", url: `${origin.url}/a.wav` });
    await take(track.packets, Number.POSITIVE_INFINITY);

    expect(await track.outcome).toEqual({ type: "ended" });
    expect(origin.requests).toMatchObject([{ path: "/a.wav", range: "bytes=0-" }]);
    await track.close();
  });

  it("plays to the end through a server that caps each range answer", async () => {
    const wav = Buffer.from(silentWav(10));
    origin = await serve(() => ({ "/a.wav": ranged(wav, undefined, 32_768) }));

    const track = await open({ kind: "url", url: `${origin.url}/a.wav` });
    const packets = await take(track.packets, Number.POSITIVE_INFINITY);

    expect(await track.outcome).toEqual({ type: "ended" });
    expect(packets.length).toBeGreaterThanOrEqual(490);
    expect(origin.requests.length).toBeGreaterThan(Math.ceil(wav.length / 32_768) - 1);
    await track.close();
  });

  it("seeks a WebM and asks for a byte range on every request", async () => {
    origin = await serve(() => ({ "/a.webm": ranged(hour) }));
    const track = await open({ kind: "url", url: `${origin.url}/a.webm` });
    await take(track.packets, 250);

    await track.seek(37);

    expect(track.position).toBeCloseTo(37, 0);
    expect(origin.requests.length).toBeGreaterThan(1);
    expect(origin.requests.every(request => /^bytes=\d+-$/.test(request.range ?? ""))).toBe(true);
    await track.close();
  });

  it("starts a range request at the resource URL and follows its redirect", async () => {
    origin = await serve(() => ({
      "/start": response => response.writeHead(302, { location: "/a.webm" }).end(),
      "/a.webm": ranged(hour),
    }));
    const track = await open({ kind: "url", url: `${origin.url}/start` });
    await take(track.packets, 5);

    await track.seek(30 * 60);

    const ranges = (path: string): (string | undefined)[] =>
      origin?.requests.filter(request => request.path === path).map(request => request.range) ?? [];
    const jumps = ranges("/a.webm").filter(range => range !== "bytes=0-");
    expect(jumps.length).toBeGreaterThan(0);
    expect(ranges("/start")).toEqual(expect.arrayContaining(jumps));
    await track.close();
  });

  it.each([
    ["the seek's first request", () => false],
    ["a range inside the file", (start: number) => start === 0],
  ])("rejects the seek when the server ignores %s and plays on", async (_name, servesLater) => {
    let switched = false;
    origin = await serve(() => ({ "/a.webm": ranged(hour, start => !switched || servesLater(start)) }));
    const track = await open({ kind: "url", url: `${origin.url}/a.webm` });
    await take(track.packets, 1000);
    switched = true;

    const failure = await failureOf(track.seek(30 * 60));

    expect(failure.message).toContain("Playback URL ignored the byte range");
    expect(failure).not.toHaveProperty("code");
    expect(track.position).toBeCloseTo(20, 0);
    expect(await take(track.packets, 50)).toHaveLength(50);
    await track.close();
  });

  it("closes the open response and a pending range request when the track stops", async () => {
    const opening = ranged(hour);
    origin = await serve(() => ({
      "/a.webm": (response, request) => {
        if (request.headers.range === "bytes=0-") opening(response, request);
      },
    }));
    const track = await open({ kind: "url", url: `${origin.url}/a.webm` });
    await take(track.packets, 5);
    const seeking = failureOf(track.seek(30 * 60));
    await vi.waitFor(() => expect(origin?.requests.some(request => request.range !== "bytes=0-")).toBe(true));

    await track.close();

    expect(await track.outcome).toEqual({ type: "closed" });
    expect(await seeking).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(origin?.requests.every(request => request.closed)).toBe(true));
    expect(origin.requests.find(request => request.range !== "bytes=0-")?.answered).toBe(false);
  });
});

describe("HLS playlist URLs", () => {
  let ts: Buffer;
  let origin: Origin | undefined;

  beforeAll(async () => {
    ts = await readFile(media.ts);
  });
  beforeEach(async () => {
    const actual = await vi.importActual<typeof NodeHttp>("node:http");
    http.request.mockImplementation(actual.request);
  });
  afterEach(() => origin?.close());

  it("plays a redirected playlist of MPEG-TS segments to the end from the redirect target", async () => {
    const cut = Math.floor(ts.length / 2 / 188) * 188;
    origin = await serve(() => ({
      "/start": response => response.writeHead(302, { location: "/list.m3u8" }).end(),
      "/list.m3u8": playlist(["a.ts", "b.ts"]),
      "/a.ts": bytes(ts.subarray(0, cut)),
      "/b.ts": bytes(ts.subarray(cut)),
    }));

    const track = await open({ kind: "url", url: `${origin.url}/start` });
    await expect(track.seek(1)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const packets = await take(track.packets, Number.POSITIVE_INFINITY);

    expect(await track.outcome).toEqual({ type: "ended" });
    expect(packets.length).toBeGreaterThanOrEqual(490);
    expect(origin.paths().filter(path => path === "/start")).toHaveLength(1);
    expect(origin.paths()).toContain("/b.ts");
    await track.close();
  });

  it.each([
    [
      "that is a local file",
      async (): Promise<Record<string, Route>> => ({ "/list.m3u8": playlist([`file://${media.ts}`]) }),
    ],
    [
      "in Matroska",
      async (): Promise<Record<string, Route>> => ({
        "/list.m3u8": playlist(["a.mkv"]),
        "/a.mkv": bytes(await readFile(media.opus)),
      }),
    ],
  ])("rejects a segment %s SOURCE_FAILED before the track starts", async (_name, routes) => {
    const table = await routes();
    origin = await serve(() => table);

    const failure = await failureOf(open({ kind: "url", url: `${origin.url}/list.m3u8` }));

    expect(failure).toMatchObject({ code: "SOURCE_FAILED" });
  });

  it("closes a pending segment request when the track stops", async () => {
    origin = await serve(() => ({
      "/list.m3u8": playlist(["a.ts", "b.ts"]),
      "/a.ts": bytes(ts),
      "/b.ts": () => undefined,
    }));
    const track = await open({ kind: "url", url: `${origin.url}/list.m3u8` });
    track.packets.on("data", () => undefined);
    await vi.waitFor(() => expect(origin?.paths()).toContain("/b.ts"));

    await track.close();

    expect(await track.outcome).toEqual({ type: "closed" });
    await vi.waitFor(() => expect(origin?.requests.find(request => request.path === "/b.ts")?.closed).toBe(true));
    expect(origin.requests.find(request => request.path === "/b.ts")?.answered).toBe(false);
  });

  it("rejects SOURCE_FAILED and closes the request when the open outlasts its deadline", async () => {
    let trickle: NodeJS.Timeout | undefined;
    origin = await serve(() => ({
      "/list.m3u8": playlist(["a.ts"]),
      "/a.ts": response => {
        response.writeHead(200, { "content-type": "video/mp2t" });
        let offset = 0;
        trickle = setInterval(() => {
          response.write(ts.subarray(offset, offset + 188));
          offset += 188;
        }, 1_000);
      },
    }));

    const started = performance.now();
    const failure = await failureOf(open({ kind: "url", url: `${origin.url}/list.m3u8` }));
    clearInterval(trickle);

    expect(failure).toMatchObject({ code: "SOURCE_FAILED" });
    expect(performance.now() - started).toBeLessThan(25_000);
    await vi.waitFor(() => expect(origin?.requests.find(request => request.path === "/a.ts")?.closed).toBe(true));
  }, 30_000);
});

describe("local input containers", () => {
  it("rejects an ffconcat stream SOURCE_FAILED without playing the file it names", async () => {
    const cwd = process.cwd();
    process.chdir(media.dir);
    try {
      const list = Readable.from([Buffer.from(`ffconcat version 1.0\nfile ${basename(media.opus)}\n`)]);

      const failure = await failureOf(open({ kind: "stream", stream: list }));

      expect(failure).toMatchObject({ code: "SOURCE_FAILED" });
      expect(failure.message).toContain("concat");
    } finally {
      process.chdir(cwd);
    }
  });

  it("plays a WAV stream", async () => {
    const track = await open({ kind: "stream", stream: Readable.from([Buffer.from(silentWav())]) });

    expect(await take(track.packets, 10)).toHaveLength(10);
    await track.close();
  });
});
