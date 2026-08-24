import { describe, expect, it } from "vitest";
import { DisTubeError, ErrorCode, ErrorReason, Filters, QueueStatus, type RepeatMode } from "../src";
import {
  capture,
  deferred,
  FakePlayer,
  GUILD,
  type Harness,
  playableSetup,
  record,
  settle,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, voiceChannelId: "voice" };

/** A playing queue holding `ids` in order: the first is current, the rest are waiting. */
async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const { queue } = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.enqueue(id);
  await settle();
  const voice = harness.distube.voices.get(GUILD);
  return { harness, queue, voice: voice as NonNullable<typeof voice>, player: harness.engine.players[0] as FakePlayer };
}

/** A queue whose Player borrow is held open until the returned gate resolves it. */
async function gated(harness: Harness) {
  const gate = deferred<FakePlayer>();
  const player = new FakePlayer();
  harness.engine.createPlayer.mockReturnValueOnce(gate.promise);
  const result = harness.distube.play(TARGET, "a");
  const { queue } = await result;
  return { result, queue, player, release: () => gate.resolve(player) };
}

describe("pause, resume, and seek", () => {
  it("moves between Playing and Paused, treating a repeated request as a no-op", async () => {
    const { harness, queue, player } = await playing(["a"]);
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
    await harness.distube.shutdown();
  });

  it("validates seek seconds and requires a current QueueItem", async () => {
    const { harness, queue } = await playing(["a"]);
    await expect(queue.seek(-1)).rejects.toThrow("Seek seconds must be non-negative");
    await expect(queue.seek(Number.NaN)).rejects.toThrow("Seek seconds must be non-negative");

    const other = playableSetup();
    const { result, queue: idle, release } = await gated(other);
    await expect(idle.pause()).rejects.toThrow("Queue has no current QueueItem");
    release();
    await result;
    await other.distube.shutdown();
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

describe("voice volume and filter rendering failures", () => {
  it("rejects a volume change the Player refused and keeps the previous setting", async () => {
    const { harness, voice, player } = await playing(["a"]);
    player.setVolume.mockRejectedValueOnce(new Error("mixer offline"));
    const failure = (await capture(voice.setVolume(30))) as DisTubeError;
    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED, message: "Player failed to set volume" });
    expect(voice.volume).toBe(100);
    await harness.distube.shutdown();
  });

  it("preserves committed active filters when the Player rejects a replacement", async () => {
    const { harness, voice, player } = await playing(["a"]);
    await voice.filters.apply(Filters.Echo);
    player.setFilters.mockRejectedValueOnce(new Error("bad chain"));

    const failure = (await capture(voice.filters.apply(Filters.Bassboost))) as DisTubeError;

    expect(failure).toMatchObject({ code: ErrorCode.VOICE_FAILED, message: "Player failed to render filters" });
    expect(voice.filters.active).toEqual([{ name: Filters.Echo }]);

    await voice.filters.apply(Filters.Nightcore);
    expect(voice.filters.active).toEqual([{ name: Filters.Echo }, { name: Filters.Nightcore }]);
    await harness.distube.shutdown();
  });

  it("preserves an invalid payload error without committing the candidate filter set", async () => {
    const { harness, voice, player } = await playing(["a"]);
    const invalidPayload = new DisTubeError(
      ErrorCode.INVALID_ARGUMENT,
      ErrorReason.Argument,
      "invalid equalizer payload",
    );
    player.setFilters.mockRejectedValueOnce(invalidPayload);

    const failure = (await capture(voice.filters.set("custom-eq", { gain: "bad" }))) as DisTubeError;

    expect(failure).toBe(invalidPayload);
    expect(voice.filters.active).toEqual([]);
    await harness.distube.shutdown();
  });

  it("holds filters set before the Player exists and renders them on the first track", async () => {
    const harness = playableSetup();
    const joined = await harness.distube.voices.join({ guildId: GUILD, channelId: VOICE_CHANNEL });
    const applying = joined.filters.set("custom-eq", { gain: 2 });
    expect(joined.filters.active).toEqual([{ name: "custom-eq", payload: { gain: 2 } }]);
    await applying;
    await harness.distube.shutdown();
  });

  it("validates filter vocabulary against the engine and the public argument rules", async () => {
    const { harness, voice } = await playing(["a"]);
    expect(voice.filters.resolvable(Filters.Bassboost)).toBe(true);
    expect(voice.filters.resolvable("nope")).toBe(false);
    await expect(voice.filters.apply("")).rejects.toThrow("filter name must be a non-empty string");
    await expect(voice.filters.apply(Filters.Bassboost, Number.NaN)).rejects.toThrow(
      "filter value must be a finite number",
    );
    await harness.distube.shutdown();
  });

  it("applies a filter set while no track is playing and renders it on the first track", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join({ guildId: GUILD, channelId: VOICE_CHANNEL });
    await voice.filters.set("custom-eq", { gain: 2 });
    expect(voice.filters.active).toEqual([{ name: "custom-eq", payload: { gain: 2 } }]);

    await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    expect(player.renders.at(-1)).toEqual([{ name: "custom-eq", payload: { gain: 2 } }]);
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

    const { queue } = await harness.distube.play(TARGET, "a");
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

    await harness.distube.play(TARGET, "a");
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
    const { harness, queue, voice } = await playing(["a", "b", "c", "d"]);

    // Zero-based: `jump(1)` names the second waiting item, which is `c`.
    await queue.jump(1, { requeue: true });
    await settle();
    expect(queue.state.current?.song.id).toBe("c");
    expect(queue.state.items.map(item => item.song.id)).toEqual(["d", "b"]);
    expect(voice.previousSongs.map(item => item.song.id)).toEqual(["a"]);

    await queue.jump(1);
    await settle();
    expect(queue.state.current?.song.id).toBe("b");
    expect(queue.state.items).toEqual([]);
    expect(voice.previousSongs.map(item => item.song.id)).toEqual(["a", "c", "d"]);
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

describe("error reasons", () => {
  it("separates a bad argument from a state the queue forbids", async () => {
    const { harness, queue } = await playing(["a", "b"]);

    const unknownItem = (await capture(queue.remove("no-such-item"))) as DisTubeError;
    expect(unknownItem).toMatchObject({ code: ErrorCode.INVALID_ARGUMENT, reason: ErrorReason.Argument });

    // The ID is real and the call is well formed; only the current state forbids it.
    const currentItem = (await capture(queue.remove(queue.state.current?.id as string))) as DisTubeError;
    expect(currentItem).toMatchObject({ code: ErrorCode.INVALID_ARGUMENT, reason: ErrorReason.State });

    const noHistory = (await capture(queue.previous())) as DisTubeError;
    expect(noHistory).toMatchObject({ code: ErrorCode.INVALID_ARGUMENT, reason: ErrorReason.State });
    await harness.distube.shutdown();
  });

  it("leaves reason undefined on a subsystem failure", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    player.stopTrack.mockRejectedValueOnce(new Error("device gone"));

    const failure = (await capture(queue.skip())) as DisTubeError;

    expect(failure.code).toBe(ErrorCode.VOICE_FAILED);
    expect(failure.reason).toBeUndefined();
    await harness.distube.shutdown();
  });
});

describe("zero-based waiting positions", () => {
  it("addresses the first waiting item as 0 for enqueue, remove, and jump", async () => {
    const { harness, queue } = await playing(["a", "b", "c"]);

    await queue.enqueue("inserted", { position: 0 });
    expect(queue.state.items.map(item => item.song.id)).toEqual(["inserted", "b", "c"]);

    const removed = await queue.remove(0);
    expect(removed.map(item => item.song.id)).toEqual(["inserted"]);
    expect(queue.state.items.map(item => item.song.id)).toEqual(["b", "c"]);

    await queue.jump(0);
    await settle();
    expect(queue.state.current?.song.id).toBe("b");
    await harness.distube.shutdown();
  });

  it("rejects a waiting position at the item count as out of range", async () => {
    const { harness, queue } = await playing(["a", "b"]);

    await expect(queue.jump(1)).rejects.toThrow("Waiting position is out of range: 1");
    await expect(queue.remove(1)).rejects.toThrow("Waiting index is out of range: 1");
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

  it("validates playback settings against the Voice surface's public argument rules", async () => {
    const { harness, voice } = await playing(["a"]);
    await expect(voice.setRepeatMode("forever" as RepeatMode)).rejects.toThrow("Unknown repeat mode: forever");
    await expect(voice.setAutoplay("yes" as unknown as boolean)).rejects.toThrow("autoplay must be a boolean");

    const other = playableSetup();
    const { queue: otherQueue } = await other.distube.play(TARGET, "a");
    await expect(otherQueue.enqueue("b", { position: -1 })).rejects.toThrow("position must be a non-negative integer");
    await expect(otherQueue.enqueue("b", { position: 1.5 })).rejects.toThrow("position must be a non-negative integer");
    await other.distube.shutdown();
    await harness.distube.shutdown();
  });
});
