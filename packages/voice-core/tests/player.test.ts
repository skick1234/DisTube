import { AudioPlayerStatus, type VoiceConnection, VoiceConnectionStatus } from "@discordjs/voice";
import { ErrorCode, Filters, type PlaybackRequest, type PlayerEvent } from "distube";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FilterRegistry } from "../src/filters";
import { DiscordVoicePlayer } from "../src/player";
import { audioPlayerError, FakeConnection, latest, native, resetNative, settle } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());
vi.mock("node:child_process", async () => (await import("./support/native")).childProcessModule());

const URL_ = "https://stream.example/audio";

function request(itemId = "item", url = URL_): PlaybackRequest {
  return { itemId, resource: { kind: "url", url, dispose: vi.fn() } };
}

/** A Player over a fake connection, plus the outcomes it publishes. */
function createPlayer(): { player: DiscordVoicePlayer; connection: FakeConnection; events: PlayerEvent[] } {
  const connection = new FakeConnection();
  native.connections.push(connection);
  const player = new DiscordVoicePlayer(connection as unknown as VoiceConnection, new FilterRegistry());
  const events: PlayerEvent[] = [];
  player.subscribe(event => events.push(event));
  return { player, connection, events };
}

/** Lets a rejected candidate enter its rollback branch without relying on a timer. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(resetNative);

describe("playback", () => {
  it("decodes the URL, hands it to the audio player, and counts the elapsed position", async () => {
    const { player, connection } = createPlayer();
    expect(player.position).toBe(0);

    await player.play(request());

    expect(connection.subscribe).toHaveBeenCalledWith(latest.player);
    expect(latest.spawn).toEqual(expect.arrayContaining(["-i", URL_, "-f", "s16le", "-ar", "48000", "-ac", "2"]));
    expect(latest.spawn).not.toContain("-ss");
    expect(latest.spawn).not.toContain("-af");
    expect(native.createAudioResource).toHaveBeenCalledWith(
      latest.child.stdout,
      expect.objectContaining({ inlineVolume: true }),
    );
    expect(latest.player.play).toHaveBeenCalledWith(latest.resource);

    latest.resource.playbackDuration = 4000;
    expect(player.position).toBe(4);
  });

  it("waits for its default-engine preflight before spawning playback", async () => {
    const connection = new FakeConnection();
    native.connections.push(connection);
    const preflight = vi.fn(async () => {
      throw new Error("FFmpeg is unavailable");
    });
    const player = new DiscordVoicePlayer(connection as unknown as VoiceConnection, new FilterRegistry(), preflight);

    await expect(player.play(request())).rejects.toThrow("FFmpeg is unavailable");

    expect(preflight).toHaveBeenCalledTimes(1);
    expect(native.spawn).not.toHaveBeenCalled();
    expect(latest.player.play).not.toHaveBeenCalled();
  });

  it("rejects a second track and every request after the connection is gone", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());

    await expect(player.play(request("other"))).rejects.toThrow("already has active playback");

    connection.transition({ status: VoiceConnectionStatus.Destroyed });
    await expect(player.play(request("later"))).rejects.toThrow("retired");
  });

  it("fails a track whose decode dies before the audio player takes it", async () => {
    const { player } = createPlayer();
    native.entersState.mockImplementation(() => new Promise(() => undefined));

    const playing = player.play(request());
    latest.child.emit("close");

    await expect(playing).rejects.toThrow("FFmpeg exited with code unknown");
    expect(latest.player.stop).toHaveBeenCalledWith(true);
    expect(latest.child.kill).toHaveBeenCalledWith("SIGKILL");
    // The Player survives the track it could not start.
    native.entersState.mockImplementation(async () => undefined);
    await expect(player.play(request("next"))).resolves.toBeUndefined();
  });

  it("redacts a spawn failure before the track starts", async () => {
    const { player, events } = createPlayer();
    const signed = "https://stream.example/audio?token=top-secret&signature=also-secret";
    native.entersState.mockImplementation(() => new Promise<undefined>(() => undefined));

    const playing = player.play(request("item", signed));
    latest.child.emit("error", new Error(`Could not spawn decoder for ${signed}`));
    const failure = await playing.then(
      () => {
        throw new Error("Expected the decoder spawn to fail");
      },
      error => error as Error,
    );

    expect(failure.message).toContain("FFmpeg could not start");
    expect(failure.message).not.toContain(signed);
    expect(failure.message).not.toContain("top-secret");
    expect(events).toEqual([]);
  });

  it("keeps a dead decode from surfacing as an unhandled error", async () => {
    const { player } = createPlayer();
    await player.play(request());

    latest.child.emit("error", new Error("ffmpeg is missing"));
    latest.child.stdout.emit("error", new Error("broken pipe"));

    expect(latest.child.stdout.destroyed).toBe(true);
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
  it("rejects the transitions the audio player refuses and cannot seek at all", async () => {
    const { player } = createPlayer();
    await player.play(request());

    latest.player.pause.mockReturnValueOnce(false);
    await expect(player.pause()).rejects.toThrow("could not pause");
    latest.player.unpause.mockReturnValueOnce(false);
    await expect(player.resume()).rejects.toThrow("could not resume");
    await expect(player.pause()).resolves.toBeUndefined();
    await expect(player.resume()).resolves.toBeUndefined();

    await expect(player.seek(30)).rejects.toMatchObject({
      code: ErrorCode.UNSUPPORTED,
      message: "The default voice engine cannot seek",
    });
  });

  it("holds the volume level across decodes and rejects an invalid one", async () => {
    const { player } = createPlayer();
    await expect(player.setVolume(-1)).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });

    await player.setVolume(50);
    await player.play(request());
    expect(latest.resource.volume.level).toBe(0.5);

    await player.setVolume(80);
    expect(latest.resource.volume.level).toBe(0.8);
  });
});

describe("filters", () => {
  it("restarts the decode at the current position under the folded chain", async () => {
    const { player, events } = createPlayer();
    await player.play(request());
    const first = latest.child;
    latest.resource.playbackDuration = 6000;

    await player.setFilters([
      { name: Filters.Bassboost, value: 5 },
      { name: "custom", payload: "volume=2" },
    ]);

    expect(latest.spawn).toEqual(expect.arrayContaining(["-ss", "6", "-af", "bass=g=5,volume=2"]));
    expect(first.kill).toHaveBeenCalledWith("SIGKILL");
    expect(player.position).toBe(6);

    first.emit("close", 1, null);
    await flushMicrotasks();
    expect(events).toEqual([]);

    // An unchanged chain leaves the running decode alone.
    await player.setFilters([
      { name: Filters.Bassboost, value: 5 },
      { name: "custom", payload: "volume=2" },
    ]);
    expect(native.children).toHaveLength(2);
  });

  it("keeps an explicitly paused track paused across the re-render", async () => {
    const { player } = createPlayer();
    await player.play(request());
    await player.pause();
    const calls = native.entersState.mock.calls.length;

    await player.setFilters([{ name: Filters.Echo }]);

    expect(latest.player.play).toHaveBeenCalledTimes(2);
    expect(latest.player.pause).toHaveBeenCalledTimes(2);
    // A held decode is already where it needs to be, so nothing waits on the audio player.
    expect(native.entersState.mock.calls).toHaveLength(calls);
  });

  it("restores the previous chain and active playback when the candidate fails", async () => {
    const { player, events } = createPlayer();
    await player.play(request());
    await player.setFilters([{ name: Filters.Echo }]);
    const previousResource = latest.resource;
    native.entersState.mockImplementation(() => new Promise<undefined>(() => undefined));

    const replacing = player.setFilters([{ name: Filters.Nightcore }]);
    latest.player.emit(
      "stateChange",
      { status: AudioPlayerStatus.Playing, resource: previousResource },
      { status: AudioPlayerStatus.Idle },
    );
    const candidateFailure = new Error("candidate decode failed");
    latest.player.emit("error", audioPlayerError(latest.resource, candidateFailure));
    native.entersState.mockResolvedValue(undefined);

    await expect(replacing).rejects.toBe(candidateFailure);
    expect(latest.spawn).toEqual(expect.arrayContaining(["-af", "aecho=0.8:0.9:1000:0.3"]));
    expect(events).toEqual([]);

    await player.stopTrack();
    await player.play(request("next"));
    expect(latest.spawn).toEqual(expect.arrayContaining(["-af", "aecho=0.8:0.9:1000:0.3"]));
  });

  it("leaves the effective render attached when a candidate fails before producing audio", async () => {
    const { player } = createPlayer();
    await player.play(request());
    const effective = latest.child;
    const handoffs = latest.player.play.mock.calls.length;
    const stops = latest.player.stop.mock.calls.length;
    native.autoAudio = false;

    const replacing = player.setFilters([{ name: Filters.Nightcore }]);
    await flushMicrotasks();
    const candidate = latest.child;

    expect(latest.player.play).toHaveBeenCalledTimes(handoffs);
    expect(latest.player.stop).toHaveBeenCalledTimes(stops);
    candidate.emit("close", 1, null);

    await expect(replacing).rejects.toThrow("FFmpeg exited with code 1");
    expect(latest.player.play).toHaveBeenCalledTimes(handoffs);
    expect(latest.player.stop).toHaveBeenCalledTimes(stops);
    expect(effective.kill).not.toHaveBeenCalled();
  });

  it("fails A without allowing its native error to poison a pre-handoff filter candidate B", async () => {
    const { player, events } = createPlayer();
    await player.play(request("A"));
    const activeResource = latest.resource;
    native.autoAudio = false;

    const replacing = player.setFilters([{ name: Filters.Nightcore }]);
    await flushMicrotasks();
    const candidate = latest.child;
    const candidateResource = latest.resource;
    const activeFailure = new Error("A native playback failed");
    latest.player.emit("error", audioPlayerError(activeResource, activeFailure));

    await expect(replacing).rejects.toBeInstanceOf(Error);
    expect(events).toEqual([{ type: "failed", itemId: "A", error: activeFailure }]);
    expect(latest.player.play).toHaveBeenCalledTimes(1);

    latest.player.emit("error", audioPlayerError(candidateResource, new Error("late B native playback failed")));
    candidate.close(0, null);
    await flushMicrotasks();

    expect(events).toEqual([{ type: "failed", itemId: "A", error: activeFailure }]);
  });

  it("reconciles a candidate Idle transition that precedes its filter commit", async () => {
    const { player, events } = createPlayer();
    await player.play(request());
    native.entersState.mockImplementation(() => new Promise<undefined>(() => undefined));

    const replacing = player.setFilters([{ name: Filters.Echo }]);
    await flushMicrotasks();
    const candidate = latest.child;
    const resource = latest.resource;
    latest.player.emit(
      "stateChange",
      { status: AudioPlayerStatus.Playing, resource },
      { status: AudioPlayerStatus.Idle },
    );
    candidate.emit("close", 0, null);

    await replacing;
    await flushMicrotasks();
    expect(events).toEqual([{ type: "finished", itemId: "item" }]);
  });

  it("retires after candidate and rollback failures in stable order", async () => {
    const { player, events } = createPlayer();
    await player.play(request());
    native.autoAudio = false;
    native.entersState.mockImplementation(() => new Promise<undefined>(() => undefined));

    const replacing = player.setFilters([{ name: Filters.Nightcore }]);
    const candidate = latest.child;
    const candidateResource = latest.resource;
    candidate.stdout.write(Buffer.from([0]));
    await flushMicrotasks();
    const candidateFailure = new Error("candidate decode failed");
    latest.player.emit("error", audioPlayerError(candidateResource, candidateFailure));
    await settle();

    const rollback = latest.child;
    const rollbackResource = latest.resource;
    expect(rollback).not.toBe(candidate);
    rollback.stdout.write(Buffer.from([0]));
    await flushMicrotasks();
    const rollbackFailure = new Error("rollback decode failed");
    latest.player.emit("error", audioPlayerError(rollbackResource, rollbackFailure));
    const failure = await replacing.then(
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
  it("shares one cleanup, fences later effects, and suppresses active item outcomes", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    const first = player.release();
    const second = player.release();

    expect(second).toBe(first);
    await first;

    expect(connection.subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(latest.player.stop).toHaveBeenCalledWith(true);
    expect(latest.child.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(player.play(request("later"))).rejects.toThrow("retired");
    await expect(player.pause()).rejects.toThrow("retired");
    latest.player.transition({ status: AudioPlayerStatus.Idle });
    connection.transition({ status: VoiceConnectionStatus.Destroyed });
    expect(events).toEqual([]);
  });

  it("runs every terminal cleanup once, waits for the decoder, and retains ordered failures", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());
    const child = latest.child;
    const unsubscribeFailure = new Error("unsubscribe failed");
    const stopFailure = new Error("native stop failed");
    const killFailure = new Error("decoder kill failed");
    connection.subscription.unsubscribe.mockImplementationOnce(() => {
      throw unsubscribeFailure;
    });
    latest.player.stop.mockImplementationOnce(() => {
      throw stopFailure;
    });
    child.kill.mockImplementationOnce(() => {
      throw killFailure;
    });

    const first = player.release();
    const second = player.release();
    let settled = false;
    void first.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    expect(second).toBe(first);
    expect(connection.subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(latest.player.stop).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(connection.listenerCount("stateChange")).toBe(0);
    expect(latest.player.listenerCount("stateChange")).toBe(0);
    expect(latest.player.listenerCount("error")).toBe(0);
    await flushMicrotasks();
    expect(settled).toBe(false);

    child.close(null, "SIGKILL");
    const failure = await first.catch(error => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([unsubscribeFailure, stopFailure, killFailure]);
  });
});

describe("outcomes", () => {
  it("reconciles an Idle transition that arrives before initial activation commits", async () => {
    const { player, events } = createPlayer();
    native.entersState.mockImplementation(() => new Promise<undefined>(() => undefined));

    const playing = player.play(request());
    const resource = latest.resource;
    latest.player.emit(
      "stateChange",
      { status: AudioPlayerStatus.Playing, resource },
      { status: AudioPlayerStatus.Idle },
    );
    latest.child.emit("close", 0, null);

    await playing;
    await flushMicrotasks();
    expect(events).toEqual([{ type: "finished", itemId: "item" }]);
  });

  it("waits for successful decoder closure after the matching resource becomes idle", async () => {
    const { player, events } = createPlayer();
    await player.play(request());

    latest.player.transition({ status: AudioPlayerStatus.Idle });
    expect(events).toEqual([]);

    latest.child.emit("close", 0, null);
    await flushMicrotasks();
    expect(events).toEqual([{ type: "finished", itemId: "item" }]);
  });

  it("reports post-start decoder failures once with bounded redacted diagnostics", async () => {
    const { player, events } = createPlayer();
    const signed = "https://stream.example/audio?token=top-secret&signature=also-secret";
    await player.play(request("item", signed));
    latest.child.stderr.write(`decoder failed for ${signed} token=another-secret\n${"x".repeat(6000)}`);

    latest.child.emit("close", 1, null);
    await flushMicrotasks();

    const failure = events[0] as Extract<PlayerEvent, { type: "failed" }>;
    expect(failure).toMatchObject({ type: "failed", itemId: "item" });
    expect(failure.error.message).toContain("FFmpeg exited with code 1");
    expect(failure.error.message).toContain("<redacted-url>");
    expect(failure.error.message).not.toContain(signed);
    expect(failure.error.message).not.toContain("top-secret");
    expect(failure.error.message).not.toContain("another-secret");
    expect(failure.error.message.length).toBeLessThan(4200);

    latest.player.transition({ status: AudioPlayerStatus.Idle });
    expect(events).toHaveLength(1);
  });

  it("reports a signaled post-start decoder exit as a failure", async () => {
    const { player, events } = createPlayer();
    await player.play(request());

    latest.child.emit("close", null, "SIGTERM");
    await flushMicrotasks();

    expect(events).toEqual([
      {
        type: "failed",
        itemId: "item",
        error: expect.objectContaining({ message: "FFmpeg exited from signal SIGTERM" }),
      },
    ]);
  });

  it("publishes a finished track, then a failed one, staying usable throughout", async () => {
    const { player, events } = createPlayer();

    await player.play(request("first"));
    latest.child.emit("close", 0, null);
    await flushMicrotasks();
    latest.player.transition({ status: AudioPlayerStatus.Idle });
    await player.play(request("second"));
    const error = new Error("decoder failed");
    latest.player.emit("error", audioPlayerError(latest.resource, error));
    await player.play(request("third"));

    expect(events).toEqual([
      { type: "finished", itemId: "first" },
      { type: "failed", itemId: "second", error },
    ]);
  });

  it("ends a track on request without publishing an outcome", async () => {
    const { player, events } = createPlayer();
    await player.play(request());

    await player.stopTrack();

    expect(latest.child.kill).toHaveBeenCalledWith("SIGKILL");
    latest.player.transition({ status: AudioPlayerStatus.Idle });
    expect(events).toEqual([]);

    // The Player is the session's, not the track's: the next request is accepted, and a second stop is a no-op.
    await player.play(request("next"));
    latest.child.exitCode = 0;
    await player.stopTrack();
    await player.stopTrack();
    expect(latest.child.kill).not.toHaveBeenCalled();
  });

  it("retires with its connection, reporting the active track exactly once", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());

    connection.transition({ status: VoiceConnectionStatus.Destroyed });

    expect(events).toEqual([{ type: "failed", itemId: "item", error: expect.any(Error), terminal: true }]);
    expect(latest.child.kill).toHaveBeenCalledWith("SIGKILL");

    latest.player.transition({ status: AudioPlayerStatus.Idle });
    connection.transition({ status: VoiceConnectionStatus.Destroyed });
    expect(events).toHaveLength(1);
    expect(player.subscribe(vi.fn())).toBeInstanceOf(Function);
  });

  it("isolates a subscriber that throws", async () => {
    const { player, events } = createPlayer();
    player.subscribe(() => {
      throw new Error("subscriber failed");
    });

    await player.play(request());
    latest.child.emit("close", 0, null);
    await flushMicrotasks();
    latest.player.transition({ status: AudioPlayerStatus.Idle });

    expect(events).toEqual([{ type: "finished", itemId: "item" }]);
  });
});
