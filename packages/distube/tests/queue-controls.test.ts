import { describe, expect, it } from "vitest";
import { DisTubeError, Song } from "../src";
import {
  capture,
  deferred,
  FakePlayer,
  GUILD,
  type Harness,
  playableSetup,
  record,
  required,
  settle,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: "voice" };

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
    expect(queue.state.status).toBe("playing");

    await queue.pause();
    expect(queue.state.status).toBe("paused");
    await queue.pause();
    expect(player.pause).toHaveBeenCalledTimes(1);

    await queue.resume();
    expect(queue.state.status).toBe("playing");
    await queue.resume();
    expect(player.resume).toHaveBeenCalledTimes(1);

    await queue.seek(42);
    expect(player.seek).toHaveBeenCalledWith(42);
    await harness.distube.dispose();
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
    await other.distube.dispose();
    await harness.distube.dispose();
  });

  it("maps incompatible Player errors once and preserves supported ones", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const sourceFailure = new DisTubeError("SOURCE_FAILED", "source did not reach the Player");
    player.pause.mockRejectedValueOnce(sourceFailure);
    const failure = (await capture(queue.pause())) as DisTubeError;
    expect(failure).toMatchObject({ code: "VOICE_FAILED", message: "Player failed to pause" });
    expect(failure.cause).toBe(sourceFailure);
    expect(queue.state.status).toBe("playing");

    const unsupportedFailure = new DisTubeError("UNSUPPORTED", "Engine cannot seek");
    player.seek.mockRejectedValueOnce(unsupportedFailure);
    const unsupported = (await capture(queue.seek(3))) as DisTubeError;
    expect(unsupported).toBe(unsupportedFailure);

    const supersededFailure = new DisTubeError("QUEUE_FAILED", "Player effect was superseded");
    player.pause.mockRejectedValueOnce(supersededFailure);
    const superseded = (await capture(queue.pause())) as DisTubeError;
    expect(superseded.code).toBe("VOICE_FAILED");
    expect(superseded.cause).toBe(supersededFailure);
    await harness.distube.dispose();
  });
});

describe("voice volume and filter rendering failures", () => {
  it("rejects a volume change the Player refused and keeps the previous setting", async () => {
    const { harness, voice, player } = await playing(["a"]);
    player.setVolume.mockRejectedValueOnce(new Error("mixer offline"));
    const failure = (await capture(voice.setVolume(30))) as DisTubeError;
    expect(failure).toMatchObject({ code: "VOICE_FAILED", message: "Player failed to set volume" });
    expect(voice.settings.volume).toBe(100);
    await harness.distube.dispose();
  });

  it("preserves committed filters when a replacement fails", async () => {
    const { harness, voice, player } = await playing(["a"]);
    await voice.setFilters(["echo"]);
    player.setFilters.mockRejectedValueOnce(new Error("bad chain"));
    await expect(voice.setFilters(["bassboost"])).rejects.toMatchObject({ code: "VOICE_FAILED" });
    expect(voice.settings.filters).toEqual(["echo"]);
    await voice.setFilters(["nightcore"]);
    expect(voice.settings.filters).toEqual(["nightcore"]);
    await harness.distube.dispose();
  });

  it("validates settings and applies settings made before playback", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    await voice.setFilters(["bassboost"]);
    await voice.setVolume(20);
    await expect(voice.setFilters(["unknown"])).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(voice.setFilters([""])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(voice.setVolume(101)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await harness.distube.play(TARGET, "a");
    await settle();
    expect(harness.engine.players[0]?.renders.at(-1)).toEqual([{ name: "bassboost" }]);
    expect(harness.engine.players[0]?.volumes).toEqual([20]);
    await harness.distube.dispose();
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
    await harness.distube.dispose();
  });

  it("fails the item when the DisTubeVoice cannot provide a Player, then exhausts the queue", async () => {
    const harness = playableSetup();
    harness.engine.createPlayer.mockRejectedValueOnce(new Error("no hardware"));
    const events = record(harness.distube, ["queue.item.failed", "queue.finished", "queue.deleted"]);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.item.failed", event => failures.push(event.error));

    await harness.distube.play(TARGET, "a");
    await settle();

    expect(events).toEqual(["queue.item.failed", "queue.finished", "queue.deleted"]);
    expect(failures).toMatchObject([{ code: "VOICE_FAILED" }]);
    await harness.distube.dispose();
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
    await harness.distube.dispose();
  });

  it("keeps the borrow after a non-terminal playback failure", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);

    player.emit({ type: "failed", itemId: player.playing as string, error: new Error("hiccup") });
    await settle();

    expect(harness.engine.createPlayer).toHaveBeenCalledTimes(1);
    expect(player.playing).toBe(queue.state.current?.id);
    expect(queue.state.current?.song.id).toBe("b");
    await harness.distube.dispose();
  });

  it("still advances when ending the track fails, surfacing the cleanup to the skipper", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    player.stopTrack.mockRejectedValueOnce(new Error("stuck"));

    const failure = (await capture(queue.skip())) as DisTubeError;
    await settle();

    expect(failure).toMatchObject({ code: "VOICE_FAILED", message: "Player failed to end the track cleanly" });
    expect(queue.state.current?.song.id).toBe("b");
    await harness.distube.dispose();
  });
});

describe("ID validation", () => {
  it("distinguishes malformed IDs from stale occurrence state", async () => {
    const { harness, queue } = await playing(["a", "b"]);
    await expect(queue.remove("missing")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.remove("")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.remove(required(queue.state.current).id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await harness.distube.dispose();
  });
});

it("rejects seek for media with unknown duration before backend work", async () => {
  const harness = playableSetup();
  const { queue } = await harness.distube.play(
    TARGET,
    new Song({ source: "source", id: "live", name: "Live", url: "https://source.example/live" }),
  );
  await settle();
  await expect(queue.seek(1)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(harness.engine.players[0]?.seek).not.toHaveBeenCalled();
  await harness.distube.dispose();
});
