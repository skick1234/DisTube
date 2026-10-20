import { EventEmitter } from "node:events";
import type * as NodeHttp from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { killFfmpeg, spawnFfmpeg, URL_READY_TIMEOUT_MS } from "../src/ffmpeg";
import { latest, native, resetNative } from "./support/native";

vi.mock("node:child_process", async () => (await import("./support/native")).childProcessModule());
const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:http", async importOriginal => ({
  ...(await importOriginal<typeof NodeHttp>()),
  request: http.request,
}));
vi.mock("node:https", () => ({ request: http.request }));
let request: EventEmitter & { destroy: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
let response: PassThrough & { statusCode: number; headers: Record<string, string> };
let respond: () => void;
beforeEach(() => {
  resetNative();
  response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
  request = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
  http.request.mockImplementation((_url, _options, callback) => {
    respond = () => callback(response);
    request.end.mockImplementation(() => respond());
    return request;
  });
});
afterEach(() => vi.useRealTimers());

describe("controlled decoder input", () => {
  it("rejects unsafe headers and URL userinfo before network or decoder work", async () => {
    await expect(
      spawnFfmpeg({ kind: "url", url: "https://example.test", headers: { Authorization: "secret\r\nX: injected" } }, 0),
    ).rejects.toThrow();
    await expect(spawnFfmpeg({ kind: "url", url: "https://user:secret@example.test" }, 0)).rejects.toThrow();
    expect(http.request).not.toHaveBeenCalled();
    expect(native.spawn).not.toHaveBeenCalled();
  });
  it("pipes an authenticated response, keeps credentials out of argv, and reopens for output seek", async () => {
    const resource = {
      kind: "url" as const,
      url: "https://example.test/audio?secret=private",
      headers: { Authorization: "secret-value" },
      seekable: true,
    };
    const first = await spawnFfmpeg(resource, 0);
    expect(http.request.mock.calls[0]?.[1]).toMatchObject({ headers: resource.headers, method: "GET" });
    expect(latest.spawn.join(" ")).not.toContain("secret");
    expect(latest.spawn).toContain("pipe,fd");
    expect(latest.spawn.indexOf("-protocol_whitelist")).toBeLessThan(latest.spawn.indexOf("-i"));
    response.write("audio");
    expect(latest.child.stdin.read()?.toString()).toBe("audio");
    killFfmpeg(first);
    await first.outcome;
    expect(response.destroyed).toBe(true);
    const second = await spawnFfmpeg(resource, 12);
    expect(http.request).toHaveBeenCalledTimes(2);
    expect(latest.spawn.indexOf("-ss")).toBeGreaterThan(latest.spawn.indexOf("-i"));
    killFfmpeg(second);
    await second.outcome;
  });
  it.each([302, 403, 500])("rejects HTTP %i without redirect forwarding", async status => {
    response.statusCode = status;
    await expect(spawnFfmpeg({ kind: "url", url: "https://example.test" }, 0)).rejects.toThrow();
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(request.destroy).toHaveBeenCalledOnce();
    expect(response.destroyed).toBe(true);
  });
  it("rejects declared nested manifests", async () => {
    response.headers["content-type"] = "application/vnd.apple.mpegurl";
    await expect(spawnFfmpeg({ kind: "url", url: "https://example.test" }, 0)).rejects.toThrow("manifest");
  });
  it("bounds readiness even when the socket never connects", async () => {
    vi.useFakeTimers();
    http.request.mockImplementation(() => request);
    const pending = spawnFfmpeg({ kind: "url", url: "https://example.test" }, 0);
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(URL_READY_TIMEOUT_MS);
    await assertion;
    expect(request.destroy).toHaveBeenCalledOnce();
  });
  it("does not impose a whole-track deadline after response headers", async () => {
    vi.useFakeTimers();
    const run = await spawnFfmpeg({ kind: "url", url: "https://example.test" }, 0);
    await vi.advanceTimersByTimeAsync(URL_READY_TIMEOUT_MS * 2);
    expect(response.destroyed).toBe(false);
    killFfmpeg(run);
    await run.outcome;
  });
  it("aborts pending HTTP readiness", async () => {
    http.request.mockImplementation(() => request);
    const controller = new AbortController();
    const pending = spawnFfmpeg({ kind: "url", url: "https://example.test" }, 0, undefined, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(request.destroy).toHaveBeenCalledOnce();
  });
  it("closes a response when cancellation wins before decoder creation", async () => {
    const controller = new AbortController();
    const pending = spawnFfmpeg({ kind: "url", url: "https://example.test" }, 0, undefined, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(response.destroyed).toBe(true);
    expect(request.destroy).toHaveBeenCalledOnce();
  });
  it("cancels active decoding and preserves safe diagnostics", async () => {
    const controller = new AbortController();
    const run = await spawnFfmpeg(
      { kind: "url", url: "https://example.test", headers: { "X-Private": "private-value" } },
      0,
      undefined,
      controller.signal,
    );
    latest.child.stderr.write("unexpected private-value");
    controller.abort();
    const outcome = await run.outcome;
    expect(outcome.error?.name).toBe("AbortError");
    expect(outcome.stderr).not.toContain("private-value");
    expect(response.destroyed).toBe(true);
    expect(latest.child.stdin.destroyed).toBe(true);
  });
  it("closes an accepted response when its request fails later", async () => {
    const url = "https://example.test/audio?token=private-url";
    const run = await spawnFfmpeg({ kind: "url", url, headers: { "X-Private": "private-header" } }, 0);
    const nativeCause = new TypeError("retry private-header");
    request.emit("error", new Error(`socket failed at ${url}`, { cause: nativeCause }));
    const outcome = await run.outcome;
    const inputError = outcome.error as Error;
    expect(inputError.message).toContain("Playback URL request failed");
    const transportError = (inputError.cause as Error).cause as Error;
    expect((transportError.cause as Error).name).toBe("TypeError");
    expect(transportError.cause).not.toBe(nativeCause);
    for (const error of [inputError, inputError.cause, transportError, transportError.cause]) {
      expect((error as Error).message).not.toMatch(/private-url|private-header/u);
    }
    expect(response.destroyed).toBe(true);
    expect(latest.child.kill).toHaveBeenCalledOnce();
  });
  it("retains a safe request cause when HTTP fails before headers", async () => {
    http.request.mockImplementation(() => request);
    const url = "https://example.test/audio?token=private-url";
    const pending = spawnFfmpeg({ kind: "url", url, headers: { Authorization: "private-header" } }, 0);
    const nativeError = Object.assign(new Error(`GET ${url}: private-header`), { code: "ECONNRESET" });
    request.emit("error", nativeError);
    const failure = await pending.then<never, Error>(
      () => {
        throw new Error("Expected HTTP playback to fail");
      },
      (error: unknown) => error as Error,
    );
    const cause = failure.cause as Error & { code?: string };
    expect(cause).not.toBe(nativeError);
    expect(cause.code).toBe("ECONNRESET");
    expect(failure.message).not.toMatch(/private-url|private-header/u);
    expect(cause.message).not.toMatch(/private-url|private-header/u);
    expect(request.destroy).toHaveBeenCalledOnce();
  });
  it("keeps operation and cleanup failures as safe aggregate causes", async () => {
    const run = await spawnFfmpeg(
      { kind: "url", url: "https://example.test/audio?token=private-url", headers: { "X-Private": "private-header" } },
      0,
    );
    const operation = Object.assign(new Error("operation private-header"), { code: "EIO" });
    const cleanup = new Error("cleanup at /private/audio.wav");
    const nativeError = new AggregateError([operation, cleanup], "input and cleanup failed");
    response.emit("error", nativeError);
    const outcome = await run.outcome;
    const aggregate = outcome.error?.cause as AggregateError;
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate).not.toBe(nativeError);
    expect(aggregate.errors[0]).not.toBe(operation);
    expect((aggregate.errors[0] as Error & { code?: string }).code).toBe("EIO");
    for (const error of [outcome.error, aggregate, ...aggregate.errors]) {
      expect((error as Error).message).not.toMatch(/private-header|private-url|\/private\/audio.wav/u);
    }
  });
  it("clears readiness work after a synchronous request failure", async () => {
    vi.useFakeTimers();
    http.request.mockImplementation(() => {
      throw new Error("private URL");
    });
    await expect(spawnFfmpeg({ kind: "url", url: "https://example.test" }, 0)).rejects.toThrow(
      "Playback URL request failed",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses input-side seek for files and rejects one-shot seeking", async () => {
    const run = await spawnFfmpeg({ kind: "file", path: "/audio.wav" }, 12);
    expect(latest.spawn.indexOf("-ss")).toBeLessThan(latest.spawn.indexOf("-i"));
    killFfmpeg(run);
    await run.outcome;
    await expect(spawnFfmpeg({ kind: "stream", stream: new PassThrough() }, 1)).rejects.toThrow("one-shot");
  });
  it.each(["readable", "stdin"])("joins cleanup after a %s failure", async side => {
    const input = new PassThrough();
    const run = await spawnFfmpeg({ kind: "stream", stream: input }, 0);
    (side === "readable" ? input : latest.child.stdin).emit("error", new Error("failed at /private/audio.wav"));
    const result = await run.outcome;
    expect(result.error?.message).not.toContain("/private/audio.wav");
    expect(result.error).toBeInstanceOf(Error);
    expect(input.destroyed).toBe(true);
    expect(latest.child.stdin.destroyed).toBe(true);
    expect(latest.child.kill).toHaveBeenCalledOnce();
  });
  it.each(["stream", "url"])("stops decoding when a %s input closes before ending", async kind => {
    const input = new PassThrough();
    const run = await spawnFfmpeg(
      kind === "url" ? { kind: "url", url: "https://example.test" } : { kind: "stream", stream: input },
      0,
    );
    (kind === "url" ? response : input).destroy();
    const outcome = await run.outcome;
    expect(outcome.error?.message).toContain("closed before ending");
    expect(latest.child.kill).toHaveBeenCalledOnce();
    expect(latest.child.stdin.destroyed).toBe(true);
  });
  it("accepts a readable that ends normally", async () => {
    const input = new PassThrough();
    const run = await spawnFfmpeg({ kind: "stream", stream: input }, 0);
    const ended = new Promise<void>(resolve => input.once("end", resolve));
    input.end("audio");
    await ended;
    latest.child.close(0, null);
    expect((await run.outcome).error).toBeUndefined();
  });
  it("cleans up a decoder when a readable throws while piping", async () => {
    const input = new PassThrough();
    vi.spyOn(input, "pipe").mockImplementation(() => {
      throw new Error("pipe failed at /private/audio.wav");
    });
    const run = await spawnFfmpeg({ kind: "stream", stream: input }, 0);
    const outcome = await run.outcome;
    expect(outcome.error?.message).toContain("Playback input pipe failed");
    expect(outcome.error?.message).not.toContain("/private/audio.wav");
    expect(input.destroyed).toBe(true);
    expect(latest.child.kill).toHaveBeenCalledOnce();
  });
  it("stops decoding when the output pipe fails", async () => {
    const run = await spawnFfmpeg({ kind: "file", path: "/audio.wav" }, 0);
    latest.child.stdout.emit("error", new Error("failed at /private/audio.wav"));
    const outcome = await run.outcome;
    expect(outcome.error?.message).toContain("FFmpeg output pipe failed");
    expect(outcome.error?.message).not.toContain("/private/audio.wav");
    expect(latest.child.kill).toHaveBeenCalledOnce();
  });
  it("pauses upstream when decoder stdin backs up", async () => {
    const input = new PassThrough();
    const run = await spawnFfmpeg({ kind: "stream", stream: input }, 0);
    input.write(Buffer.alloc(256 * 1024));
    expect(input.isPaused()).toBe(true);
    killFfmpeg(run);
    await run.outcome;
  });
});
