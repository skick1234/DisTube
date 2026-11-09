import { afterEach, describe, expect, it, vi } from "vitest";
import { DisTubeError } from "../src";
import { isTransientFailure, type PluginReport, retryRequest } from "../src/integrations";
import { capture } from "./support/harness";

const answer = (status: number) => new Response(null, { status });
const nodeReset = () =>
  new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
const bunRefused = () => Object.assign(new TypeError("Unable to connect"), { code: "ECONNREFUSED" });
const timedOut = () => new DOMException("The operation timed out.", "TimeoutError");

function options(signal = new AbortController().signal) {
  const report = vi.fn<PluginReport>();
  return { signal, name: "spotify", host: "api.spotify.com", report };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("retryRequest", () => {
  it("sends a 503 three times, waiting up to 250 ms and then up to 1 s, and resolves with the last answer", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const send = vi.fn(async () => answer(503));
    const call = options();

    const settled = retryRequest(send, call);
    await vi.advanceTimersByTimeAsync(249);
    const beforeFirstWait = send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(999);
    const beforeSecondWait = send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    const last = await settled;

    expect([beforeFirstWait, beforeSecondWait, send.mock.calls.length]).toEqual([1, 2, 3]);
    expect(last.status).toBe(503);
    expect(call.report.mock.calls.map(([diagnostic]) => diagnostic.data)).toEqual([
      { attempt: 1, host: "api.spotify.com", status: 503 },
      { attempt: 2, host: "api.spotify.com", status: 503 },
    ]);
  });

  it("reports a retry as an info diagnostic named by the caller", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const send = vi.fn<() => Promise<Response>>().mockResolvedValueOnce(answer(504)).mockResolvedValue(answer(200));
    const call = { ...options(), name: "soundcloud", host: "api-v2.soundcloud.com" };

    const last = await retryRequest(send, call);

    expect(last.status).toBe(200);
    expect(call.report.mock.calls).toEqual([
      [
        {
          severity: "info",
          stage: "soundcloud.request.retried",
          message: expect.any(String),
          data: { attempt: 1, host: "api-v2.soundcloud.com", status: 504 },
        },
      ],
    ]);
  });

  it.each([
    ["404", () => Promise.resolve(answer(404))],
    ["429", () => Promise.resolve(answer(429))],
  ])("sends a %s once and resolves with it", async (status, send) => {
    const call = options();
    const sent = vi.fn(send);

    const last = await retryRequest(sent, call);

    expect([sent.mock.calls.length, call.report.mock.calls.length]).toEqual([1, 0]);
    expect(last.status).toBe(Number(status));
  });

  it.each([
    ["a Node reset", nodeReset, "UND_ERR_SOCKET"],
    ["a Bun refused connection", bunRefused, "ECONNREFUSED"],
  ])("tries again after %s and names its code", async (_name, failure, code) => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const send = vi.fn<() => Promise<Response>>().mockRejectedValueOnce(failure()).mockResolvedValue(answer(200));
    const call = options();

    const last = await retryRequest(send, call);

    expect(last.status).toBe(200);
    expect(call.report.mock.calls.map(([diagnostic]) => diagnostic.data)).toEqual([
      { attempt: 1, host: "api.spotify.com", error: code },
    ]);
  });

  it("tries again after a thrown error that carries status 503 and reports the status", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const unavailable = Object.assign(new Error("api answered 503"), { status: 503 });
    const send = vi.fn<() => Promise<string>>().mockRejectedValueOnce(unavailable).mockResolvedValue("tracks");
    const call = options();

    const found = await retryRequest(send, call);

    expect(found).toBe("tracks");
    expect(call.report.mock.calls.map(([diagnostic]) => diagnostic.data)).toEqual([
      { attempt: 1, host: "api.spotify.com", status: 503 },
    ]);
  });

  it("does not resend a request whose own AbortSignal.timeout fired", async () => {
    const send = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          const timeout = AbortSignal.timeout(5);
          timeout.addEventListener("abort", () => reject(timeout.reason));
        }),
    );

    const failure = await capture(retryRequest(send, options()));

    expect(failure).toMatchObject({ name: "TimeoutError" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not resend a fetch error whose cause is a timeout, even with a reset code beside it", async () => {
    const failure = Object.assign(new TypeError("fetch failed", { cause: timedOut() }), { code: "ECONNRESET" });
    const send = vi.fn(() => Promise.reject(failure));

    await expect(retryRequest(send, options())).rejects.toBe(failure);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("settles the first answer once the caller's signal aborted", async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => {
      controller.abort();
      return answer(503);
    });
    const call = options(controller.signal);

    const last = await retryRequest(send, call);

    expect(last.status).toBe(503);
    expect([send.mock.calls.length, call.report.mock.calls.length]).toEqual([1, 0]);
  });

  it("rejects with the abort reason when the caller aborts during a wait, and sends no more", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const controller = new AbortController();
    const send = vi.fn(async () => answer(503));
    const reason = new Error("command cancelled");

    const settled = capture(retryRequest(send, options(controller.signal)));
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(2000);

    expect(await settled).toBe(reason);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not retry a DisTubeError another layer threw, even over a reset", async () => {
    const failure = new DisTubeError("SOURCE_FAILED", "inner plugin failed", { cause: nodeReset(), transient: true });
    const send = vi.fn(() => Promise.reject(failure));

    await expect(retryRequest(send, options())).rejects.toBe(failure);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("asks the caller's predicate about a thrown error and names the error's code", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const library = Object.assign(new Error("player answered HTTP 503"), { code: "REQUEST_FAILED" });
    const verdict = Object.assign(new Error("video is private"), { code: "PRIVATE" });
    const transient = (error: unknown) => error === library;
    const rescued = vi.fn<() => Promise<string>>().mockRejectedValueOnce(library).mockResolvedValue("info");
    const refused = vi.fn(() => Promise.reject(verdict));
    const call = options();

    const found = await retryRequest(rescued, { ...call, transient });
    const failure = await capture(retryRequest(refused, { ...call, transient }));

    expect([found, failure]).toEqual(["info", verdict]);
    expect([rescued.mock.calls.length, refused.mock.calls.length]).toEqual([2, 1]);
    expect(call.report.mock.calls.map(([diagnostic]) => diagnostic.data)).toEqual([
      { attempt: 1, host: "api.spotify.com", error: "REQUEST_FAILED" },
    ]);
  });

  it("does not resend a timeout the caller's predicate accepts", async () => {
    const failure = Object.assign(new Error("request failed", { cause: timedOut() }), { code: "REQUEST_FAILED" });
    const send = vi.fn(() => Promise.reject(failure));

    await expect(retryRequest(send, { ...options(), transient: () => true })).rejects.toBe(failure);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("isTransientFailure", () => {
  it.each([
    ["a 503 answer", answer(503), true],
    ["a 408 answer", answer(408), true],
    ["a 429 answer", answer(429), false],
    ["a 404 answer", answer(404), false],
    ["an error carrying status 502", Object.assign(new Error("bad gateway"), { status: 502 }), true],
    ["a Node reset", nodeReset(), true],
    ["a Bun refused connection", bunRefused(), true],
    ["a timeout", timedOut(), false],
    ["an abort", new DOMException("aborted", "AbortError"), false],
    ["a request error caused by a timeout", new Error("request failed", { cause: timedOut() }), false],
    ["a transient DisTubeError", new DisTubeError("SOURCE_FAILED", "down", { transient: true }), true],
    ["a DisTubeError over a reset", new DisTubeError("SOURCE_FAILED", "down", { cause: nodeReset() }), false],
    ["a plain error", new Error("parse failed"), false],
  ])("reads %s as %s", (_name, value, expected) => {
    expect(isTransientFailure(value)).toBe(expected);
  });
});
