import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { DisTubeError, Song } from "../src";
import type { PlaybackResource } from "../src/integrations";
import {
  capture,
  deferred,
  FakePlayer,
  GUILD,
  type Harness,
  media,
  playableSetup,
  record,
  required,
  settle,
} from "./support/harness";

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

describe("pause and resume", () => {
  it("moves between playing and paused once each, treating a repeated request as a no-op", async () => {
    const { harness, queue, player } = await playing(["a"]);
    expect([queue.status, queue.paused]).toEqual(["playing", false]);

    await queue.pause();
    expect([queue.status, queue.paused]).toEqual(["paused", true]);
    await queue.pause();
    expect(player.pause).toHaveBeenCalledTimes(1);

    await queue.resume();
    expect([queue.status, queue.paused]).toEqual(["playing", false]);
    await queue.resume();
    expect(player.resume).toHaveBeenCalledTimes(1);
    await harness.distube.dispose();
  });

  it.each(["searching", "preparing", "creating the Player"] as const)(
    "rejects pause and resume INVALID_STATE while the first item is %s",
    async stage => {
      const harness = playableSetup();
      if (stage === "searching") harness.source.search.mockImplementationOnce(() => new Promise(() => undefined));
      if (stage === "preparing") harness.source.stream.mockImplementationOnce(() => new Promise(() => undefined));
      const creating = stage === "creating the Player" ? await gated(harness) : undefined;
      if (!creating) void capture(harness.distube.play(TARGET, "a"));
      await settle();
      const queue = required(harness.distube.getQueue(GUILD));

      await expect(queue.pause()).rejects.toMatchObject({ code: "INVALID_STATE" });
      await expect(queue.resume()).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect(queue.paused).toBe(false);
      creating?.release();
      await settle();
      if (creating) {
        expect(creating.player.playing).toBe("a");
        expect([creating.player.pause.mock.calls, creating.player.resume.mock.calls]).toEqual([[], []]);
      }
    },
  );

  it("wraps a plain Player Error as VOICE_FAILED and passes a DisTubeError through, keeping the item playing", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const plain = new Error("mixer offline");
    player.pause.mockRejectedValueOnce(plain);
    const failure = (await capture(queue.pause())) as DisTubeError;
    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(failure.cause).toBe(plain);
    expect([queue.status, queue.paused]).toEqual(["playing", false]);

    const backendFailure = new DisTubeError("UNAVAILABLE", "node went away");
    player.pause.mockRejectedValueOnce(backendFailure);
    expect(await capture(queue.pause())).toBe(backendFailure);
    expect(queue.status).toBe("playing");
    await harness.distube.dispose();
  });

  it.each(["finish", "skip"] as const)("starts the next item unpaused when a paused item ends by %s", async end => {
    const { queue, player } = await playing(["a", "b"]);
    await queue.pause();
    expect(queue.status).toBe("paused");
    if (end === "finish") player.finish();
    else await queue.skip();
    await settle();

    expect(queue.current?.song.id).toBe("b");
    expect(player.playing).toBe("b");
    expect([queue.status, queue.paused]).toEqual(["playing", false]);
    expect(player.resume).not.toHaveBeenCalled();
  });

  it("rejects a pause queued behind a setting when skip ends its item first, and plays the next item unpaused", async () => {
    const { queue, voice, player } = await playing(["a", "b"]);
    const volume = player.gate("volume");
    const setting = voice.setVolume(50);
    await volume.entered;
    const pausing = capture(queue.pause());
    await queue.skip();
    await settle();
    volume.resolve();
    await setting;

    expect(await pausing).toMatchObject({ code: "INVALID_STATE" });
    expect(player.pause).not.toHaveBeenCalled();
    expect(player.playing).toBe("b");
    expect([queue.status, queue.paused]).toEqual(["playing", false]);
  });

  it("rejects a pause queued behind a setting when skip ends its item before the Player settles it", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const play = required(player.play.getMockImplementation());
    const held = deferred<void>();
    player.play.mockImplementationOnce(async (resource, options) => {
      const end = await play(resource, options);
      await held.promise;
      return end;
    });
    const queue = await harness.distube.play(TARGET, "a");
    await queue.add("b");
    await settle();
    const voice = required(harness.distube.voices.get(GUILD));
    const volume = player.gate("volume");
    const setting = voice.setVolume(50);
    await volume.entered;
    const pausing = capture(queue.pause());
    const skipping = queue.skip();
    volume.resolve();
    await setting;
    await settle();
    held.resolve();
    await skipping;
    await settle();

    expect(await pausing).toMatchObject({ code: "INVALID_STATE" });
    expect(player.pause).not.toHaveBeenCalled();
    expect(player.playing).toBe("b");
    expect([queue.status, queue.paused]).toEqual(["playing", false]);
    await harness.distube.dispose();
  });
});

describe("seek", () => {
  it("forwards a seek and reports the Player's position for the current item only", async () => {
    const { harness, queue, player } = await playing(["a"]);
    await queue.seek(42);
    expect(player.seek).toHaveBeenCalledWith(42);
    player.position = 42;
    expect(queue.position).toBe(42);
    await queue.stop();
    expect(queue.position).toBe(0);
    await harness.distube.dispose();
  });

  it("validates seek seconds and requires a started current QueueItem", async () => {
    const { harness, queue } = await playing(["a"]);
    await expect(queue.seek(-1)).rejects.toThrow("Seek seconds must be non-negative");
    await expect(queue.seek(Number.NaN)).rejects.toThrow("Seek seconds must be non-negative");

    await queue.stop();
    await expect(queue.seek(1)).rejects.toMatchObject({ code: "INVALID_STATE" });

    const other = playableSetup();
    const { result, queue: starting, release } = await gated(other);
    await expect(starting.seek(1)).rejects.toMatchObject({ code: "INVALID_STATE" });
    release();
    await result;
    await other.distube.dispose();
    await harness.distube.dispose();
  });

  it("rejects a malformed seek INVALID_ARGUMENT even with no current item", async () => {
    const harness = playableSetup();
    const held = deferred<readonly Song[]>();
    harness.source.search.mockImplementationOnce(() => held.promise);
    const started = harness.distube.play(TARGET, "a");
    const queue = required(harness.distube.getQueue(GUILD));
    for (const seconds of [-1, Number.NaN])
      await expect(queue.seek(seconds)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.seek(1)).rejects.toMatchObject({ code: "INVALID_STATE" });
    held.resolve([media("source", "a")]);
    await started;
  });

  it.each([
    [0, true],
    [60, true],
    [60.001, false],
  ])("seek(%s) on a 60 second item is accepted: %s", async (seconds, accepted) => {
    const { queue, player } = await playing(["a"]);
    const result = await capture(queue.seek(seconds));
    if (accepted) {
      expect(result).toBeUndefined();
      expect(player.seek).toHaveBeenCalledWith(seconds);
    } else {
      expect(result).toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(player.seek).not.toHaveBeenCalled();
    }
  });

  it.each<[string, () => PlaybackResource]>([
    ["stream", () => ({ kind: "stream", stream: Readable.from(["audio"]) })],
    ["url", () => ({ kind: "url", url: "https://stream.example/live" })],
    ["encoded without seekable", () => ({ kind: "encoded", format: "fake", encoded: "track" })],
  ])("rejects seek UNSUPPORTED for a %s resource and keeps the item playing", async (_kind, resource) => {
    const harness = playableSetup();
    harness.source.stream.mockImplementationOnce(async () => resource());
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.player;

    await expect(queue.seek(10)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(player.seek).not.toHaveBeenCalled();
    expect(player.playing).toBeDefined();
    expect(queue.current?.song.id).toBe("a");
  });

  it("passes the engine's UNSUPPORTED and ABORTED rejections through and wraps a plain Error VOICE_FAILED", async () => {
    const { queue, player } = await playing(["a"]);
    for (const failure of [
      new DisTubeError("UNSUPPORTED", "Engine cannot seek"),
      new DisTubeError("ABORTED", "Superseded by a later seek", { cause: new Error("later seek") }),
    ]) {
      player.seek.mockRejectedValueOnce(failure);
      expect(await capture(queue.seek(3))).toBe(failure);
    }
    const plain = new Error("decoder hiccup");
    player.seek.mockRejectedValueOnce(plain);
    expect(await capture(queue.seek(3))).toMatchObject({ code: "VOICE_FAILED", cause: plain });
    expect(player.playing).toBe("a");
  });

  it("rejects a seek INVALID_STATE when its item fails before the seek lands", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    const seeking = player.gate("seek");
    const seek = capture(queue.seek(30));
    await seeking.entered;
    player.fail(new Error("decoder lost"));
    await settle();
    seeking.reject(new Error("pipeline closed"));

    expect(await seek).toMatchObject({ code: "INVALID_STATE" });
    expect(queue.current?.song.id).toBe("b");
    await harness.distube.dispose();
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
});

const songs = (items: readonly { song: Song }[]): string[] => items.map(item => item.song.id);

describe("commands issued while an item is ending", () => {
  it("rejects a second skip in the same tick INVALID_STATE and records the skipped item once", async () => {
    const { harness, queue, player } = await playing(["a", "b", "c"]);
    const skipping = capture(queue.skip());
    const second = capture(queue.skip());

    expect(await second).toMatchObject({ code: "INVALID_STATE" });
    expect(await skipping).toBeUndefined();
    await settle();
    expect(songs(queue.history)).toEqual(["a"]);
    expect(queue.current?.song.id).toBe("b");
    expect(songs(queue.upcoming)).toEqual(["c"]);
    expect(player.played).toEqual(["a", "b"]);
    await harness.distube.dispose();
  });

  it("replays the skipped item as a new occurrence when previous follows skip in the same tick", async () => {
    const { harness, queue, player } = await playing(["a", "b", "c", "d"]);
    player.finish();
    await settle();
    player.finish();
    await settle();
    const c = required(queue.current);

    const commands = [capture(queue.skip()), capture(queue.previous())];
    expect(await Promise.all(commands)).toEqual([undefined, undefined]);
    await settle();

    expect(songs(queue.history)).toEqual(["a", "b"]);
    expect(queue.current?.song).toBe(c.song);
    expect(queue.current?.id).not.toBe(c.id);
    expect(songs(queue.upcoming)).toEqual(["d"]);
    await harness.distube.dispose();
  });

  it("returns the ended item to upcoming once when previous is called twice in the same tick", async () => {
    const { harness, queue, player } = await playing(["a", "b", "c", "d"]);
    player.finish();
    await settle();
    player.finish();
    await settle();
    const [a, b] = queue.history;
    const c = required(queue.current);
    const d = required(queue.upcoming[0]);

    const commands = [capture(queue.previous()), capture(queue.previous())];

    expect(songs(queue.upcoming)).toEqual(["a", "b", "c", "d"]);
    expect(queue.upcoming.map(item => item.id).slice(2)).toEqual([c.id, d.id]);
    expect([queue.upcoming[0]?.id === a?.id, queue.upcoming[1]?.id === b?.id]).toEqual([false, false]);
    expect(await Promise.all(commands)).toEqual([undefined, undefined]);
    await harness.distube.dispose();
  });

  it("keeps every occurrence ID unique when previous follows a requeue jump in the same tick", async () => {
    const { harness, queue, player } = await playing(["h", "a", "b", "c"]);
    player.finish();
    await settle();
    const h = required(queue.history[0]);
    const a = required(queue.current);
    const [b, c] = queue.upcoming;

    const commands = [capture(queue.jump(1, { requeue: true })), capture(queue.previous())];

    expect(queue.upcoming[0]?.song).toBe(h.song);
    expect(queue.upcoming[0]?.id).not.toBe(h.id);
    expect(queue.upcoming.slice(1).map(item => item.id)).toEqual([b?.id, c?.id, a.id]);
    expect(await Promise.all(commands)).toEqual([undefined, undefined]);
    await settle();
    const ids = [queue.current, ...queue.upcoming, ...queue.history].map(item => item?.id);
    expect(new Set(ids).size).toBe(ids.length);
    await harness.distube.dispose();
  });
});

describe("voice volume", () => {
  it("applies volumes up to 1000 and rejects 1001 without a Player command", async () => {
    const { harness, voice, player } = await playing(["a"]);
    player.setVolume.mockClear();
    await voice.setVolume(1000);
    await voice.setVolume(250);
    await expect(voice.setVolume(1001)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(player.setVolume.mock.calls).toEqual([[1000], [250]]);
    expect(voice.volume).toBe(250);
    await harness.distube.dispose();
  });

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
    const events = record(harness.distube, ["queue.item.failed", "queue.item.started"]);
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
