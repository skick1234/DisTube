import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import type * as NodeHttp from "node:http";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type LocalPlaybackResource, URL_READY_TIMEOUT_MS } from "../src/input";
import { Track } from "../src/track";
import { createMedia, type MediaFixtures, PLAIN, take } from "./support/media";

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
  readonly headers: Record<string, string>;
  readonly request: FakeRequest;
  readonly response: FakeResponse;
}

let media: MediaFixtures;
let body: Buffer;
let sent: Sent[];
/** Answers every request from `body`, honouring its Range header; `false` withholds the response. */
let answer: (request: Sent) => boolean | undefined;

beforeAll(async () => {
  media = await createMedia();
  body = await readFile(media.hour);
}, 30_000);
afterAll(() => media.cleanup());

beforeEach(() => {
  sent = [];
  answer = ({ headers, response }) => {
    const range = headers.Range?.match(/^bytes=(\d+)-(\d+)$/u);
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), body.length - 1);
      response.statusCode = 206;
      response.headers["content-range"] = `bytes ${start}-${end}/${body.length}`;
      response.end(body.subarray(start, end + 1));
    } else {
      response.end(body);
    }
    return true;
  };
  http.request.mockImplementation(
    (url: URL, options: { headers: Record<string, string> }, callback: (response: FakeResponse) => void) => {
      const request: FakeRequest = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
      const response: FakeResponse = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
      const entry = { url, headers: options.headers, request, response };
      sent.push(entry);
      request.end.mockImplementation(() => {
        if (answer(entry) !== false) callback(response);
      });
      return request;
    },
  );
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
  it("sends copied headers with byte ranges and seeks with a range at the target", async () => {
    const headers = { Authorization: "private-value" };
    const track = await open({ kind: "url", url: "https://example.test/audio?token=private", headers, seekable: true });
    await take(track.packets, 10);
    const opened = sent.length;

    await track.seek(30 * 60);

    expect(sent[0]?.headers).toEqual({ Authorization: "private-value", Range: `bytes=0-${256 * 1024 - 1}` });
    expect(sent.every(request => request.url.host === "example.test")).toBe(true);
    const ranges = sent.slice(opened).map(request => Number(request.headers.Range?.match(/^bytes=(\d+)/u)?.[1]));
    expect(ranges.some(start => start > body.length / 3)).toBe(true);
    expect(track.position).toBeGreaterThanOrEqual(30 * 60);
    await track.close();
    expect(sent.every(request => request.response.destroyed || request.response.readableEnded)).toBe(true);
  });

  it("plays a non-seekable URL from one request without a range", async () => {
    const track = await open({ kind: "url", url: "https://example.test/live" });
    await take(track.packets, 10);

    await expect(track.seek(5)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers.Range).toBeUndefined();
    await track.close();
    expect(sent[0]?.response.destroyed).toBe(true);
  });

  it("fails after start with a redacted, bounded cause", async () => {
    const url = "https://example.test/live?signature=private-signature";
    answer = ({ response }) => {
      response.write(body.subarray(0, 400_000));
      return true;
    };
    const track = await open({ kind: "url", url, headers: { "X-Session": "private-header" } });
    await take(track.packets, 5);

    sent[0]?.response.destroy(new Error(`reset while reading ${url} with private-header ${"x".repeat(8000)}`));
    await take(track.packets, Number.POSITIVE_INFINITY);
    const outcome = await track.outcome;

    const error = outcome.type === "failed" ? outcome.error : new Error("Expected a failed outcome");
    const text = JSON.stringify(causes(error).map(cause => cause.message));
    expect(error.message).toContain("Decode failed during read");
    expect(error.message).toContain("<redacted>");
    expect(Buffer.byteLength(error.message)).toBeLessThanOrEqual(4096);
    expect(text).not.toMatch(/private-signature|private-header/u);
    await track.close();
  });

  it.each([302, 403, 500])("rejects HTTP %i without following it", async status => {
    answer = ({ response }) => {
      response.statusCode = status;
      response.headers.location = "https://elsewhere.test/audio";
      return true;
    };

    const failure = await failureOf(
      open({ kind: "url", url: "https://example.test", headers: { Authorization: "x" } }),
    );

    expect(failure.message).toContain(status === 302 ? "redirected" : "non-success status");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.request.destroy).toHaveBeenCalledOnce();
    expect(sent[0]?.response.destroyed).toBe(true);
  });

  it("rejects a nested media manifest", async () => {
    answer = ({ response }) => {
      response.headers["content-type"] = "application/vnd.apple.mpegurl";
      return true;
    };

    await expect(open({ kind: "url", url: "https://example.test" })).rejects.toThrow("manifest");
  });

  it("fails a seek whose origin stops honouring byte ranges and keeps the old input", async () => {
    const track = await open({ kind: "url", url: "https://example.test/audio", seekable: true });
    await take(track.packets, 10);
    const ranged = answer;
    answer = request => {
      if (request.headers.Range?.startsWith("bytes=0-")) return ranged(request);
      request.response.end(body);
      return true;
    };

    await expect(track.seek(30 * 60)).rejects.toThrow();
    expect(await take(track.packets, 10)).toHaveLength(10);
    expect(track.position).toBeLessThan(5);
    await track.close();
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
      request.emit("error", Object.assign(new Error(`GET ${url}: private-header`), { code: "ECONNRESET" }));
      return false;
    };

    const failure = await failureOf(open({ kind: "url", url, headers: { Authorization: "private-header" } }));

    const chain = causes(failure);
    expect(failure.message).toContain("Playback URL request failed");
    expect(chain.some(error => Reflect.get(error, "code") === "ECONNRESET")).toBe(true);
    expect(JSON.stringify(chain.map(error => error.message))).not.toMatch(/private-url|private-header/u);
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
