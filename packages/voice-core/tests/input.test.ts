import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import type * as NodeHttp from "node:http";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type LocalPlaybackResource, URL_READY_TIMEOUT_MS } from "../src/sources";
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
  it("plays a URL from one request and refuses to seek it", async () => {
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

  it("rejects a nested media manifest", async () => {
    answer = ({ response }) => {
      response.headers["content-type"] = "application/vnd.apple.mpegurl";
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
