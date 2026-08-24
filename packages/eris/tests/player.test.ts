import { FilterRegistry } from "@distube/voice-core/core";
import { ErrorCode, Filters, type PlaybackRequest, type PlayerEvent } from "distube";
import type { VoiceConnection } from "eris";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErisVoicePlayer } from "../src/player";
import {
  emitRawEnd,
  emitRawError,
  FakeVoiceConnection,
  finishCurrent,
  latest,
  native,
  resetNative,
  settle,
} from "./support/eris";

vi.mock("node:child_process", async () => (await import("./support/eris")).childProcessModule());

const URL_ = "https://stream.example/audio";

function request(itemId = "item", url = URL_): PlaybackRequest {
  return { itemId, resource: { kind: "url", url, dispose: vi.fn() } };
}

/** A Player over a fake connection, plus the outcomes it publishes. */
function createPlayer(): { player: ErisVoicePlayer; connection: FakeVoiceConnection; events: PlayerEvent[] } {
  const connection = new FakeVoiceConnection();
  const player = new ErisVoicePlayer(connection as unknown as VoiceConnection, new FilterRegistry());
  const events: PlayerEvent[] = [];
  player.subscribe(event => events.push(event));
  return { player, connection, events };
}

beforeEach(resetNative);

describe("playback", () => {
  it("hands prepared PCM to Eris and counts the elapsed position", async () => {
    const { player, connection } = createPlayer();
    expect(player.position).toBe(0);

    await player.play(request());

    expect(connection.play).toHaveBeenCalledWith(latest.child.stdout, {
      format: "pcm",
      inlineVolume: true,
      voiceDataTimeout: 15_000,
    });
    expect(latest.spawn).toEqual(expect.arrayContaining(["-i", URL_, "-f", "s16le", "-ar", "48000", "-ac", "2"]));
    expect(connection.setVolume).toHaveBeenCalledWith(1);

    (connection.current as { playTime: number }).playTime = 4000;
    expect(player.position).toBe(4);
  });

  it("waits for its default-engine preflight before starting playback", async () => {
    const connection = new FakeVoiceConnection();
    const preflight = vi.fn(async () => {
      throw new Error("FFmpeg is unavailable");
    });
    const player = new ErisVoicePlayer(connection as unknown as VoiceConnection, new FilterRegistry(), preflight);

    await expect(player.play(request())).rejects.toThrow("FFmpeg is unavailable");

    expect(preflight).toHaveBeenCalledTimes(1);
    expect(connection.play).not.toHaveBeenCalled();
  });

  it("rejects a second track and every request after retirement", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());

    await expect(player.play(request("other"))).rejects.toThrow("already has active playback");

    connection.emit("disconnect");
    await expect(player.play(request("later"))).rejects.toThrow("retired");
  });

  it("fails the request when Eris does not start the track, staying usable", async () => {
    const { player, connection } = createPlayer();
    connection.play.mockImplementationOnce(() => undefined);

    await expect(player.play(request())).rejects.toThrow("could not start the track");

    await expect(player.play(request("next"))).resolves.toBeUndefined();
  });

  it.each([
    [undefined, "must be an object"],
    [{ itemId: "", resource: request().resource }, "only itemId and resource"],
    [{ itemId: "item", resource: undefined }, "must be a URL resource"],
    [{ itemId: "item", resource: { kind: "url", url: "file:///audio", dispose: vi.fn() } }, "absolute HTTP(S)"],
    [{ itemId: "item", resource: { kind: "stream", url: URL_, dispose: vi.fn() } }, "valid URL resource"],
  ])("rejects a malformed playback request %#", async (value, message) => {
    const { player } = createPlayer();
    await expect(player.play(value as unknown as PlaybackRequest)).rejects.toThrow(message);
  });

  it("declines an encoded resource as unsupported rather than malformed", async () => {
    const { player } = createPlayer();
    const encoded = { itemId: "item", resource: { kind: "encoded", data: "track", dispose: vi.fn() } };

    await expect(player.play(encoded as unknown as PlaybackRequest)).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED,
      message: "The default voice engine cannot play encoded resources",
    });
  });
});

describe("controls", () => {
  it("pauses and resumes only while a track is active, and cannot seek at all", async () => {
    const { player, connection } = createPlayer();
    await expect(player.pause()).rejects.toThrow("no active playback");
    await expect(player.resume()).rejects.toThrow("no active playback");

    await player.play(request());
    // The hand-off clears the connection's pause state, so a first track is never silently muted.
    expect(connection.resume).toHaveBeenCalledTimes(1);
    expect(connection.pause).not.toHaveBeenCalled();

    await player.pause();
    await player.resume();

    expect(connection.pause).toHaveBeenCalledTimes(1);
    expect(connection.resume).toHaveBeenCalledTimes(2);
    await expect(player.seek(30)).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED,
      message: "The default voice engine cannot seek",
    });
  });

  it("plays the first track through a connection Eris left paused", async () => {
    const { player, connection } = createPlayer();
    // Eris keeps pause state on the VoiceConnection, not on the stream, so a connection paused before
    // this Player existed would swallow its first track outright.
    connection.paused = true;

    await player.play(request());

    expect(connection.resume).toHaveBeenCalledTimes(1);
    expect(connection.paused).toBe(false);
  });

  it("holds the volume level across tracks and rejects an invalid one", async () => {
    const { player, connection } = createPlayer();
    await expect(player.setVolume(-1)).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });

    await player.setVolume(50);
    expect(connection.setVolume).toHaveBeenLastCalledWith(0.5);

    await player.play(request());
    expect(connection.setVolume).toHaveBeenLastCalledWith(0.5);
  });
});

describe("filters", () => {
  it("restarts the decode at the current position under the folded chain", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());
    (connection.current as { playTime: number }).playTime = 6000;

    await player.setFilters([
      { name: Filters.Bassboost, value: 5 },
      { name: "custom", payload: "volume=2" },
    ]);

    expect(latest.spawn).toEqual(expect.arrayContaining(["-ss", "6", "-af", "bass=g=5,volume=2"]));
    expect(player.position).toBe(6);

    // An unchanged chain leaves the running decode alone.
    await player.setFilters([
      { name: Filters.Bassboost, value: 5 },
      { name: "custom", payload: "volume=2" },
    ]);
    expect(connection.play).toHaveBeenCalledTimes(2);
  });

  it("keeps an explicitly paused track paused across the re-render", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());
    await player.pause();

    await player.setFilters([{ name: Filters.Echo }]);

    expect(connection.pause).toHaveBeenCalledTimes(2);
  });

  it("restores the previous chain and active playback when the candidate fails", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    await player.setFilters([{ name: Filters.Echo }]);
    (connection.current as { playTime: number }).playTime = 6000;
    connection.play.mockImplementationOnce(() => undefined);

    await expect(player.setFilters([{ name: Filters.Nightcore }])).rejects.toThrow("could not start the track");

    expect(latest.spawn).toEqual(expect.arrayContaining(["-ss", "6", "-af", "aecho=0.8:0.9:1000:0.3"]));
    expect(events).toEqual([]);

    await player.stopTrack();
    await player.play(request("next"));
    expect(latest.spawn).toEqual(expect.arrayContaining(["-af", "aecho=0.8:0.9:1000:0.3"]));
  });

  it("leaves the effective render attached when a candidate decoder fails before handoff", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());
    const effective = latest.child;
    const stops = connection.nativeStopPlaying.mock.calls.length;
    const handoffs = connection.play.mock.calls.length;
    native.autoAudio = false;

    const replacing = player.setFilters([{ name: Filters.Nightcore }]);
    await settle();
    const candidate = latest.child;

    expect(connection.nativeStopPlaying).toHaveBeenCalledTimes(stops);
    expect(connection.play).toHaveBeenCalledTimes(handoffs);
    candidate.close(1, null);

    await expect(replacing).rejects.toThrow("FFmpeg exited with code 1");
    expect(connection.nativeStopPlaying).toHaveBeenCalledTimes(stops);
    expect(connection.play).toHaveBeenCalledTimes(handoffs);
    expect(effective.kill).not.toHaveBeenCalled();
  });

  it("retires after candidate and rollback failures in stable order", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    const candidateFailure = new Error("candidate decoder failed");
    const rollbackFailure = new Error("rollback decoder failed");
    connection.play.mockImplementationOnce(() => {
      throw candidateFailure;
    });
    connection.play.mockImplementationOnce(() => {
      throw rollbackFailure;
    });

    const failure = await player.setFilters([{ name: Filters.Nightcore }]).then(
      () => undefined,
      error => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([candidateFailure, rollbackFailure]);
    expect(events).toEqual([{ type: "failed", itemId: "item", error: failure, terminal: true }]);
    await expect(player.play(request("next"))).rejects.toThrow("retired");
  });

  it("stores a chain committed with no active track for the next one", async () => {
    const { player } = createPlayer();
    await player.setFilters([{ name: Filters.Vaporwave }]);

    await player.play(request());

    expect(latest.spawn).toEqual(expect.arrayContaining(["-af", "asetrate=48000*0.8,aresample=48000,bass=g=5"]));
  });
});

describe("terminal release", () => {
  it("shares one cleanup, waits for decoder close, and leaves only the permanent error sink", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    const child = latest.child;
    const stops = connection.nativeStopPlaying.mock.calls.length;
    const first = player.release();
    const second = player.release();
    let settled = false;
    void first.then(() => {
      settled = true;
    });

    expect(second).toBe(first);
    expect(connection.nativeStopPlaying).toHaveBeenCalledTimes(stops + 1);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await settle();
    expect(settled).toBe(false);

    child.close(null, "SIGKILL");
    await first;

    expect(connection.stopPlaying).toBe(connection.nativeStopPlaying);
    expect(connection.listenerCount("end")).toBe(0);
    expect(connection.listenerCount("error")).toBe(1);
    expect(connection.listenerCount("disconnect")).toBe(0);
    await expect(player.play(request("later"))).rejects.toThrow("retired");
    await expect(player.pause()).rejects.toThrow("retired");
    emitRawEnd(connection);
    emitRawError(connection, new Error("late error"));
    connection.emit("disconnect");
    expect(events).toEqual([]);
  });

  it("aggregates listener, decoder, and native-stop cleanup failures in order", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());
    const child = latest.child;
    const listenerFailure = new Error("listener removal failed");
    const decoderFailure = new Error("decoder cleanup failed");
    const stopFailure = new Error("native stop failed");
    vi.spyOn(connection, "off").mockImplementation(() => {
      throw listenerFailure;
    });
    child.kill.mockImplementationOnce(() => {
      throw decoderFailure;
    });
    connection.nativeStopPlaying.mockImplementationOnce(() => {
      throw stopFailure;
    });

    const release = player.release();
    child.close(null, null);
    const failure = await release.catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([listenerFailure, decoderFailure, stopFailure]);
    await expect(player.play(request("later"))).rejects.toThrow("retired");
  });
});

describe("outcomes", () => {
  it("reports a post-start decoder failure instead of accepting later raw callbacks", async () => {
    const { player, connection, events } = createPlayer();
    const signed = "https://stream.example/audio?api_key=top-secret";
    await player.play(request("item", signed));
    latest.child.stderr.write(`decoder failed for ${signed}`);

    latest.child.close(1, null);
    await settle();
    emitRawEnd(connection);
    emitRawError(connection, new Error("late socket callback"));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "failed", itemId: "item" });
    const event = events[0] as Extract<PlayerEvent, { type: "failed" }>;
    expect(event.error.message).toContain("FFmpeg exited with code 1");
    expect(event.error.message).not.toContain("top-secret");
  });

  it("ignores raw errors through recovery while the active track remains playable", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A"));

    emitRawError(connection, new Error("socket hiccup"));
    connection.beginRecovery();
    connection.becomeReady();

    expect(events).toEqual([]);
    await player.pause();
    expect(connection.pause).toHaveBeenCalledTimes(1);
    expect(player.position).toBeGreaterThanOrEqual(0);
  });

  it("reports only terminal disconnect when a raw error happens first", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A"));
    const child = latest.child;
    const disconnect = new Error("connection lost");

    emitRawError(connection, new Error("socket hiccup"));
    connection.emit("disconnect", disconnect);
    child.close(null, "SIGKILL");
    await settle();

    expect(events).toEqual([{ type: "failed", itemId: "A", error: disconnect, terminal: true }]);
  });

  it("publishes a finished track, then a failed one, staying usable throughout", async () => {
    const { player, connection, events } = createPlayer();

    await player.play(request("first"));
    latest.child.close(0, null);
    finishCurrent(connection);
    await settle();
    await player.play(request("second"));
    latest.child.close(1, null);
    await settle();
    await player.play(request("third"));

    expect(events).toEqual([
      { type: "finished", itemId: "first" },
      expect.objectContaining({ type: "failed", itemId: "second" }),
    ]);
  });

  it("ignores a delayed raw end from A until B's own native completion", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A"));
    const first = latest.child;
    await player.stopTrack();
    await player.play(request("B"));
    const second = latest.child;

    emitRawEnd(connection);
    second.close(0, null);
    await settle();

    expect(events).toEqual([]);
    expect(connection.playing).toBe(true);
    finishCurrent(connection);
    await settle();

    expect(events).toEqual([{ type: "finished", itemId: "B" }]);
    first.close(null, "SIGKILL");
  });

  it("ignores a delayed raw error from A until B's own native completion", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A"));
    const first = latest.child;
    await player.stopTrack();
    await player.play(request("B"));
    const second = latest.child;

    emitRawError(connection, new Error("late error from A"));
    second.close(0, null);
    await settle();

    expect(events).toEqual([]);
    expect(connection.playing).toBe(true);
    finishCurrent(connection);
    await settle();

    expect(events).toEqual([{ type: "finished", itemId: "B" }]);
    first.close(null, "SIGKILL");
  });

  it("ends a track on request and suppresses its later raw callbacks", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    const child = latest.child;

    await player.stopTrack();
    emitRawEnd(connection);
    emitRawError(connection, new Error("late error"));

    expect(connection.nativeStopPlaying).toHaveBeenCalled();
    expect(events).toEqual([]);
    child.close(null, "SIGKILL");
    // The Player is the session's, not the track's: a second stop is a no-op and the next track is accepted.
    await player.stopTrack();
    await expect(player.play(request("next"))).resolves.toBeUndefined();
  });

  it("rejects an unready native stop as a finished-track signal", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    connection.ready = false;
    latest.child.close(0, null);
    finishCurrent(connection);
    await settle();

    expect(events).toEqual([]);
  });

  it("reports one failure when native completion is followed by decoder failure callbacks", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    const child = latest.child;

    finishCurrent(connection);
    child.close(1, null);
    finishCurrent(connection);
    child.close(1, null);
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "failed", itemId: "item" });
    expect(events).not.toContainEqual({ type: "finished", itemId: "item" });
  });

  it("retires with its connection, reporting the active track exactly once", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    const child = latest.child;

    connection.emit("disconnect", new Error("connection lost"));
    child.close(null, "SIGKILL");
    await settle();

    expect(events).toEqual([{ type: "failed", itemId: "item", error: expect.any(Error), terminal: true }]);

    emitRawEnd(connection);
    emitRawError(connection, new Error("late error"));
    connection.emit("disconnect");
    expect(events).toHaveLength(1);
    expect(player.subscribe(vi.fn())).toBeInstanceOf(Function);
  });

  it("isolates a subscriber that throws", async () => {
    const { player, connection, events } = createPlayer();
    player.subscribe(() => {
      throw new Error("subscriber failed");
    });

    await player.play(request());
    latest.child.close(0, null);
    finishCurrent(connection);
    await settle();

    expect(events).toEqual([{ type: "finished", itemId: "item" }]);
  });
});
