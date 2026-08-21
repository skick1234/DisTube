import { describe, expect, it } from "vitest";
import { DisTubeError, ErrorCode, Filters, QueueStatus, type RepeatMode } from "../src";
import { capture, deferred, FakePlayer, type Harness, playableSetup, record, settle } from "./support/harness";

/** A playing queue holding `ids` in order: the first is current, the rest are waiting. */
async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const { queue } = await harness.distube.play({ guildId: "guild", voiceChannelId: "voice" }, ids[0] as string);
  for (const id of ids.slice(1)) await queue.enqueue(id);
  await settle();
  return { harness, queue, player: harness.engine.players[0] as FakePlayer };
}

/** A queue whose Player borrow is held open until the returned gate resolves it. */
async function gated(harness: Harness) {
  const gate = deferred<FakePlayer>();
  const player = new FakePlayer();
  harness.engine.createPlayer.mockReturnValueOnce(gate.promise);
  const result = harness.distube.play({ guildId: "guild", voiceChannelId: "voice" }, "a");
  const { queue } = await result;
  return { result, queue, player, release: () => gate.resolve(player) };
}

describe("pause, resume, and seek", () => {
  it("moves between Playing and Paused, treating a repeated request as a no-op", async () => {
    const { queue, player } = await playing(["a"]);
    expect(queue.state.status).toBe(QueueStatus.Playing);

    await queue.pause();
    expect(queue.state.status).toBe(QueueStatus.Paused);
    await queue.pause();
    expect(player.pause).toHaveBeenCalledTimes(1);

    await queue.resume();
    expect(queue.state.status).toBe(QueueStatus.Playing);
    await queue.resume();
    expect(player.resume).toHaveBeenCalledTimes(1);

    await queue.seek(42);
    expect(player.seek).toHaveBeenCalledWith(42);
  });

  it("validates seek seconds and requires a current QueueItem", async () => {
    const { queue } = await playing(["a"]);
    await expect(queue.seek(-1)).rejects.toThrow("Seek seconds must be non-negative");
    await expect(queue.seek(Number.NaN)).rejects.toThrow("Seek seconds must be non-negative");

    const harness = playableSetup();
    const { result, queue: idle, release } = await gated(harness);
    await expect(idle.pause()).rejects.toThrow("Queue has no current QueueItem");
    release();
    await result;
    await harness.distube.shutdown();
  });

  it("maps incompatible Player errors once and preserves supported ones", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const sourceFailure = new DisTubeError(ErrorCode.SOURCE_FAILED, "source did not reach the Player");
    player.pause.mockRejectedValueOnce(sourceFailure);
    const failure = (await capture(queue.pause())) as DisTubeError;
    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED, message: "Player failed to pause" });
    expect(failure.cause).toBe(sourceFailure);
    expect(queue.state.status).toBe(QueueStatus.Playing);

    const unsupportedFailure = new DisTubeError(ErrorCode.UNSUPPORTED, "Engine cannot seek");
    player.seek.mockRejectedValueOnce(unsupportedFailure);
    const unsupported = (await capture(queue.seek(3))) as DisTubeError;
    expect(unsupported).toBe(unsupportedFailure);

    const supersededFailure = new DisTubeError(ErrorCode.QUEUE_FAILED, "Player effect was superseded");
    player.pause.mockRejectedValueOnce(supersededFailure);
    const superseded = (await capture(queue.pause())) as DisTubeError;
    expect(superseded).toBe(supersededFailure);
    await harness.distube.shutdown();
  });
});

describe("volume and filter rendering failures", () => {
  it("rejects a volume change the Player refused and keeps the previous setting", async () => {
    const { harness, queue, player } = await playing(["a"]);
    player.setVolume.mockRejectedValueOnce(new Error("mixer offline"));
    const failure = (await capture(queue.setVolume(30))) as DisTubeError;
    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED, message: "Player failed to set volume" });
    expect(queue.volume).toBe(100);
    await harness.distube.shutdown();
  });

  it("preserves committed active filters when the Player rejects a replacement", async () => {
    const { harness, queue, player } = await playing(["a"]);
    await queue.filters.apply(Filters.Echo);
    player.setFilters.mockRejectedValueOnce(new Error("bad chain"));

    const failure = (await capture(queue.filters.apply(Filters.Bassboost))) as DisTubeError;

    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED, message: "Player failed to render filters" });
    expect(queue.filters.active).toEqual([{ name: Filters.Echo }]);

    await queue.filters.apply(Filters.Nightcore);
    expect(queue.filters.active).toEqual([{ name: Filters.Echo }, { name: Filters.Nightcore }]);
    await harness.distube.shutdown();
  });

  it("preserves an invalid payload error without committing the candidate filter set", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const invalidPayload = new DisTubeError(ErrorCode.INVALID_ARGUMENT, "invalid equalizer payload");
    player.setFilters.mockRejectedValueOnce(invalidPayload);

    const failure = (await capture(queue.filters.set("custom-eq", { gain: "bad" }))) as DisTubeError;

    expect(failure).toBe(invalidPayload);
    expect(queue.filters.active).toEqual([]);
    await harness.distube.shutdown();
  });

  it("holds filters set before the borrow and applies them when the Player arrives", async () => {
    const harness = playableSetup();
    const { result, queue, player, release } = await gated(harness);
    await queue.filters.set("custom-eq", { gain: 2 });
    expect(queue.filters.active).toEqual([{ name: "custom-eq", payload: { gain: 2 } }]);

    release();
    await result;
    await settle();
    expect(player.renders[0]).toEqual([{ name: "custom-eq", payload: { gain: 2 } }]);
    await harness.distube.shutdown();
  });

  it("validates filter vocabulary against the engine and the public argument rules", async () => {
    const { harness, queue } = await playing(["a"]);
    expect(queue.filters.resolvable(Filters.Bassboost)).toBe(true);
    expect(queue.filters.resolvable("nope")).toBe(false);
    await expect(queue.filters.apply("")).rejects.toThrow("filter name must be a non-empty string");
    await expect(queue.filters.apply(Filters.Bassboost, Number.NaN)).rejects.toThrow(
      "filter value must be a finite number",
    );
    await harness.distube.shutdown();
  });
});

describe("playback failure paths", () => {
  it("fails the item whose start the Player rejected, then plays the next one on the same borrow", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    player.play.mockRejectedValueOnce(new Error("cannot start"));
    harness.engine.createPlayer.mockResolvedValueOnce(player);
    const events = record(harness.distube, ["queue.item.failed", "queue.item.started"]);

    const { queue } = await harness.distube.play({ guildId: "guild", voiceChannelId: "voice" }, "a");
    await queue.enqueue("b");
    await settle();

    expect(events).toEqual(["queue.item.failed", "queue.item.started"]);
    expect(player.stopTrack).toHaveBeenCalledTimes(1);
    expect(harness.source.disposed).toEqual(["a"]);
    expect(queue.state.current?.song.id).toBe("b");
    await harness.distube.shutdown();
  });

  it("fails the item when the Voice cannot provide a Player, then exhausts the queue", async () => {
    const harness = playableSetup();
    harness.engine.createPlayer.mockRejectedValueOnce(new Error("no hardware"));
    const events = record(harness.distube, ["queue.item.failed", "queue.finished", "queue.deleted"]);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.item.failed", event => failures.push(event.error));

    await harness.distube.play({ guildId: "guild", voiceChannelId: "voice" }, "a");
    await settle();

    expect(events).toEqual(["queue.item.failed", "queue.finished", "queue.deleted"]);
    expect(failures).toMatchObject([{ code: ErrorCode.VOICE_FAILED }]);
    await harness.distube.shutdown();
  });

  it("retires a terminally failed Player and borrows a fresh one for the next item", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    const events = record(harness.distube, ["queue.item.failed", "queue.item.started"]);

    player.emit({ type: "failed", itemId: player.playing as string, error: new Error("device lost"), terminal: true });
    await settle();

    expect(events).toEqual(["queue.item.failed", "queue.item.started"]);
    expect(harness.engine.createPlayer).toHaveBeenCalledTimes(2);
    expect((harness.engine.players[1] as FakePlayer).playing).toBe(queue.state.current?.id);
    expect(queue.state.current?.song.id).toBe("b");
    await harness.distube.shutdown();
  });

  it("keeps the borrow after a non-terminal playback failure", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);

    player.emit({ type: "failed", itemId: player.playing as string, error: new Error("hiccup") });
    await settle();

    expect(harness.engine.createPlayer).toHaveBeenCalledTimes(1);
    expect(player.playing).toBe(queue.state.current?.id);
    expect(queue.state.current?.song.id).toBe("b");
    await harness.distube.shutdown();
  });

  it("still advances when ending the track fails, surfacing the cleanup to the skipper", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    player.stopTrack.mockRejectedValueOnce(new Error("stuck"));

    const failure = (await capture(queue.skip())) as DisTubeError;
    await settle();

    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED, message: "Player failed to end the track cleanly" });
    expect(queue.state.current?.song.id).toBe("b");
    await harness.distube.shutdown();
  });
});

describe("jump", () => {
  it("re-queues the passed occurrences behind the target when asked, and records them otherwise", async () => {
    const { harness, queue } = await playing(["a", "b", "c", "d"]);

    await queue.jump(2, { requeue: true });
    await settle();
    expect(queue.state.current?.song.id).toBe("c");
    expect(queue.state.items.map(item => item.song.id)).toEqual(["d", "b"]);
    expect(queue.previousSongs.map(item => item.song.id)).toEqual(["a"]);

    await queue.jump(2);
    await settle();
    expect(queue.state.current?.song.id).toBe("b");
    expect(queue.state.items).toEqual([]);
    expect(queue.previousSongs.map(item => item.song.id)).toEqual(["a", "c", "d"]);
    await harness.distube.shutdown();
  });

  it("rejects an unknown target before ending the current track", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    await expect(queue.jump(9)).rejects.toThrow();
    expect(player.stopTrack).not.toHaveBeenCalled();
    expect(queue.state.current?.song.id).toBe("a");
    await harness.distube.shutdown();
  });
});

describe("public argument validation", () => {
  it("rejects invalid enqueue input without calling a source provider or publishing an item", async () => {
    const { harness, queue } = await playing(["a"]);
    const calls = harness.source.resolve.mock.calls.length;
    const events = record(harness.distube, ["queue.item.added", "queue.playlist.added"]);

    const failure = (await capture(queue.enqueue(""))) as DisTubeError;

    expect(failure).toMatchObject({ code: ErrorCode.INVALID_ARGUMENT });
    expect(harness.source.resolve).toHaveBeenCalledTimes(calls);
    expect(events).toEqual([]);
    await harness.distube.shutdown();
  });

  it("rejects vocabulary outside the closed enums and malformed positions", async () => {
    const { harness, queue } = await playing(["a"]);
    expect(() => queue.setRepeatMode("forever" as RepeatMode)).toThrow("Unknown repeat mode: forever");
    expect(() => queue.setAutoplay("yes" as unknown as boolean)).toThrow("autoplay must be a boolean");
    await expect(queue.enqueue("b", { position: -1 })).rejects.toThrow("position must be a non-negative integer");
    await expect(queue.enqueue("b", { position: 1.5 })).rejects.toThrow("position must be a non-negative integer");
    await harness.distube.shutdown();
  });
});
