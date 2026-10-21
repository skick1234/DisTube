import { describe, expect, it } from "vitest";
import { DisTubeError, Song } from "../src";
import { capture, deferred, FakePlayer, GUILD, type Harness, playableSetup, record, settle } from "./support/harness";

const TARGET = { guildId: GUILD, id: "voice" };

/** A playing queue holding `ids` in order: the first is current, the rest are waiting. */
async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const queue = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.add(id);
  await settle();
  const voice = harness.distube.voices.get(GUILD);
  return { harness, queue, voice: voice as NonNullable<typeof voice>, player: harness.engine.players[0] as FakePlayer };
}

/** A queue whose Player creation is held open until the returned gate resolves it. */
async function gated(harness: Harness) {
  const gate = deferred<FakePlayer>();
  const player = new FakePlayer();
  harness.engine.createPlayer.mockReturnValueOnce(gate.promise);
  const result = harness.distube.play(TARGET, "a");
  const queue = await result;
  return { result, queue, player, release: () => gate.resolve(player) };
}

describe("pause, resume, and seek", () => {
  it("moves between Playing and Paused, treating a repeated request as a no-op", async () => {
    const { harness, queue, player } = await playing(["a"]);
    expect(queue.status).toBe("playing");

    await queue.pause();
    expect(queue.status).toBe("paused");
    await queue.pause();
    expect(player.pause).toHaveBeenCalledTimes(1);

    await queue.resume();
    expect(queue.status).toBe("playing");
    await queue.resume();
    expect(player.resume).toHaveBeenCalledTimes(1);

    await queue.seek(42);
    expect(player.seek).toHaveBeenCalledWith(42);
    player.position = 42;
    expect(queue.position).toBe(42);
    await queue.stop();
    expect(queue.position).toBe(0);
    await harness.distube.dispose();
  });

  it("validates seek seconds and requires a current QueueItem", async () => {
    const { harness, queue } = await playing(["a"]);
    await expect(queue.seek(-1)).rejects.toThrow("Seek seconds must be non-negative");
    await expect(queue.seek(Number.NaN)).rejects.toThrow("Seek seconds must be non-negative");

    await queue.stop();
    await expect(queue.pause()).rejects.toMatchObject({ code: "INVALID_STATE" });

    const other = playableSetup();
    const { result, queue: starting, release } = await gated(other);
    await expect(starting.pause()).rejects.toMatchObject({ code: "INVALID_STATE" });
    release();
    await result;
    await other.distube.dispose();
    await harness.distube.dispose();
  });

  it("wraps a plain Player Error as VOICE_FAILED once and passes a DisTubeError through unchanged", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const plain = new Error("mixer offline");
    player.pause.mockRejectedValueOnce(plain);
    const failure = (await capture(queue.pause())) as DisTubeError;
    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.cause).toBe(plain);
    expect(queue.status).toBe("playing");

    const unsupportedFailure = new DisTubeError("UNSUPPORTED", "Engine cannot seek");
    player.seek.mockRejectedValueOnce(unsupportedFailure);
    expect(await capture(queue.seek(3))).toBe(unsupportedFailure);

    const backendFailure = new DisTubeError("UNAVAILABLE", "node went away");
    player.pause.mockRejectedValueOnce(backendFailure);
    expect(await capture(queue.pause())).toBe(backendFailure);
    await harness.distube.dispose();
  });
});

describe("voice volume", () => {
  it("rejects a volume change the Player refused and keeps the previous setting", async () => {
    const { harness, voice, player } = await playing(["a"]);
    player.setVolume.mockRejectedValueOnce(new Error("mixer offline"));
    const failure = (await capture(voice.setVolume(30))) as DisTubeError;
    expect(failure).toMatchObject({ code: "VOICE_FAILED", message: "Player failed to set volume" });
    expect(voice.volume).toBe(100);
    await harness.distube.dispose();
  });
});

describe("playback failure paths", () => {
  it("fails the item whose start the Player rejected, then plays the next one on the same Player", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    player.play.mockRejectedValueOnce(new Error("cannot start"));
    harness.engine.createPlayer.mockResolvedValueOnce(player);
    const events = record(harness.distube, ["queue.item.failed", "queue.item.started", "queue.history.added"]);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.item.failed", event => failures.push(event.error));

    const queue = await harness.distube.play(TARGET, "a");
    await queue.add("b");
    await settle();

    expect(events).toEqual(["queue.item.failed", "queue.item.started"]);
    expect(failures).toMatchObject([{ code: "VOICE_FAILED" }]);
    expect(harness.source.disposed).toEqual(["a"]);
    expect(harness.engine.createPlayer).toHaveBeenCalledTimes(1);
    expect(queue.current?.song.id).toBe("b");
    expect(queue.history).toEqual([]);
    await harness.distube.dispose();
  });

  it("fails the item when the voice cannot create a Player, then exhausts the queue", async () => {
    const harness = playableSetup();
    harness.engine.createPlayer.mockRejectedValueOnce(new Error("no hardware"));
    const events = record(harness.distube, ["queue.item.failed", "queue.finished", "queue.deleted"]);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.item.failed", event => failures.push(event.error));

    await harness.distube.play(TARGET, "a");
    await settle();

    expect(events).toEqual(["queue.item.failed", "queue.finished", "queue.deleted"]);
    expect(failures).toMatchObject([{ code: "VOICE_FAILED" }]);
    expect(harness.source.disposed).toEqual(["a"]);
    await harness.distube.dispose();
  });

  it("keeps the Player after a non-terminal playback failure", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);

    player.fail(new Error("hiccup"));
    await settle();

    expect(harness.engine.createPlayer).toHaveBeenCalledTimes(1);
    expect(player.playing).toBe(queue.current?.song.id);
    expect(queue.current?.song.id).toBe("b");
    await harness.distube.dispose();
  });
});

it("allows seek for seekable media with unknown duration", async () => {
  const harness = playableSetup();
  const queue = await harness.distube.play(
    TARGET,
    new Song({ source: "source", id: "live", name: "Live", url: "https://source.example/live" }),
  );
  await settle();
  await queue.seek(1);
  expect(harness.engine.players[0]?.seek).toHaveBeenCalledWith(1);
  await harness.distube.dispose();
});
