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
  updates,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: "voice" };

/** A playing queue holding `ids` in order: the first is current, the rest are waiting. */
async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const { queue } = await harness.distube.play(TARGET, ids[0] as string);
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
  const { queue } = await result;
  return { result, queue, player, release: () => gate.resolve(player) };
}

/** A queue playing one item from a `url` resource. */
async function playingUrl() {
  const harness = playableSetup();
  harness.source.stream.mockImplementationOnce(async () => ({ kind: "url", url: "https://cdn.example/a.webm" }));
  const { queue } = await harness.distube.play(TARGET, "a");
  await settle();
  return { queue, player: harness.engine.player };
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
    const { queue } = await harness.distube.play(TARGET, "a");
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
    ["encoded without seekable", () => ({ kind: "encoded", format: "fake", encoded: "track" })],
  ])("rejects seek UNSUPPORTED for a %s resource and keeps the item playing", async (_kind, resource) => {
    const harness = playableSetup();
    harness.source.stream.mockImplementationOnce(async () => resource());
    const { queue } = await harness.distube.play(TARGET, "a");
    await settle();
    const player = harness.engine.player;

    await expect(queue.seek(10)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(player.seek).not.toHaveBeenCalled();
    expect(player.playing).toBeDefined();
    expect(queue.current?.song.id).toBe("a");
  });

  it("forwards a url seek to the Player and resolves once it resolves", async () => {
    const { queue, player } = await playingUrl();
    const seeking = player.gate("seek");
    let resolved = false;
    const seek = queue.seek(30).then(() => (resolved = true));
    await seeking.entered;
    await settle();
    const before = resolved;

    seeking.resolve();
    await seek;

    expect(player.seek).toHaveBeenCalledWith(30);
    expect(before).toBe(false);
  });

  it("passes the Player's UNSUPPORTED for a url through and keeps the item playing", async () => {
    const { queue, player } = await playingUrl();
    const failure = new DisTubeError("UNSUPPORTED", "This playback resource is not seekable");
    player.seek.mockRejectedValueOnce(failure);

    expect(await capture(queue.seek(30))).toBe(failure);
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
    const { queue } = await harness.distube.play(
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
    const b = queue.upcoming[0];
    const skipping = capture(queue.skip());
    const second = capture(queue.skip());

    expect(await second).toMatchObject({ code: "INVALID_STATE" });
    expect(await skipping).toBe(b);
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
    const d = required(queue.upcoming[0]);

    const commands = [capture<unknown>(queue.skip()), capture<unknown>(queue.previous())];
    expect(await Promise.all(commands)).toEqual([d, undefined]);
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

describe("skip result", () => {
  it("resolves the item that was next, then undefined for the last item while autoplay looks one up", async () => {
    const { harness, queue } = await playing(["a", "b"]);
    harness.source.related.mockResolvedValue(media("source", "related"));
    const b = required(queue.upcoming[0]);
    queue.setAutoplay(true);

    const next = await queue.skip();
    await settle();
    expect(next?.id).toBe(b.id);
    expect(queue.current?.id).toBe(b.id);

    expect(await queue.skip()).toBeUndefined();
    await settle();
    expect(harness.source.related).toHaveBeenCalledTimes(1);
    expect(queue.current?.song.id).toBe("related");
    await harness.distube.dispose();
  });

  it("resolves the item behind a preparing item it cancels", async () => {
    const harness = playableSetup();
    const preparation = deferred<PlaybackResource>();
    harness.source.stream.mockImplementationOnce(() => preparation.promise);
    await harness.distube.play(TARGET, "a");
    const queue = required(harness.distube.getQueue(GUILD));
    await queue.add("b");
    await settle();
    const [a, b] = queue.upcoming;

    const skipping = queue.skip();
    preparation.resolve(harness.source.resource("a"));
    const next = await skipping;
    await settle();

    expect(next?.id).toBe(b?.id);
    expect([...queue.upcoming, ...queue.history].some(item => item.id === a?.id)).toBe(false);
    expect(harness.source.stream.mock.calls.map(([song]) => song.id)).toEqual(["a", "b"]);
    expect(harness.engine.player.playing).toBe("b");
    await harness.distube.dispose();
  });

  it("cancels the head and keeps an item whose preparation was moved behind it", async () => {
    const { harness, queue, player } = await playing(["a", "b", "c"]);
    const held = deferred<PlaybackResource>();
    harness.source.stream.mockImplementationOnce(() => held.promise);
    const [b, c] = queue.upcoming.map(item => item.id) as [string, string];
    player.finish();
    await settle();
    queue.move(b);

    const skipping = queue.skip();
    held.resolve(harness.source.resource("b"));
    const next = await skipping;
    await settle();

    expect(next?.id).toBe(b);
    expect([...queue.upcoming, ...queue.history].some(item => item.id === c)).toBe(false);
    expect(songs(queue.history)).toEqual(["a"]);
    expect(queue.current?.id).toBe(b);
    expect(player.played).toEqual(["a", "b"]);
    await harness.distube.dispose();
  });

  it("cancels the waiting head when a listener skips from the commit that finished the current item", async () => {
    const { harness, queue, player } = await playing(["a", "b", "c"]);
    const [b, c] = queue.upcoming.map(item => item.id) as [string, string];
    const skipped: Promise<unknown>[] = [];
    harness.distube.on("queue.item.finished", event => void skipped.push(capture(event.queue.skip())));

    player.finish();
    await settle();

    expect(skipped).toHaveLength(1);
    expect(((await skipped[0]) as { id?: string } | undefined)?.id).toBe(c);
    expect([...queue.upcoming, ...queue.history].some(item => item.id === b)).toBe(false);
    expect(queue.current?.id).toBe(c);
    expect(player.played).toEqual(["a", "c"]);
    await harness.distube.dispose();
  });
});

describe("queue.updated from commands", () => {
  it("publishes nothing for a jump to the item already being prepared", async () => {
    const harness = playableSetup();
    const preparation = deferred<PlaybackResource>();
    harness.source.stream.mockImplementationOnce(() => preparation.promise);
    const { queue } = await harness.distube.play(TARGET, "a");
    await queue.add("b");
    await settle();
    const ids = queue.upcoming.map(item => item.id);
    const published = updates(harness.distube);

    await queue.jump(1);
    await queue.jump(ids[0] as string, { requeue: true });
    expect(published).toEqual([]);
    expect([queue.status, queue.upcoming.map(item => item.id)]).toEqual(["preparing", ids]);

    preparation.resolve(harness.source.resource("a"));
    await settle();
    expect(harness.engine.player.playing).toBe("a");
    await harness.distube.dispose();
  });

  it("publishes one update for each acknowledged pause, resume and seek", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const published = updates(harness.distube);
    player.position = 30;
    player.seek.mockImplementationOnce(async seconds => {
      player.position = seconds;
    });

    await queue.pause();
    await settle();
    expect(published.map(event => [event.state.status, event.position])).toEqual([["paused", 30]]);
    await queue.resume();
    await queue.seek(42);
    await settle();

    expect(published.map(event => [event.state.status, event.position])).toEqual([
      ["paused", 30],
      ["playing", 30],
      ["playing", 42],
    ]);
    await harness.distube.dispose();
  });

  it("publishes nothing for calls that leave the committed value equal, and one update per real edit", async () => {
    const { harness, queue, voice } = await playing(["a", "b", "c"]);
    const [b, c] = queue.upcoming.map(item => item.id) as [string, string];
    await queue.pause();
    await voice.filters.set("bassboost", 5);
    await settle();
    const published = updates(harness.distube);

    queue.setRepeat("off");
    queue.move(b, c);
    queue.move(c);
    await voice.setVolume(100);
    await voice.filters.set("bassboost", 5);
    await queue.pause();
    await settle();
    expect(published).toEqual([]);

    queue.move(c, b);
    queue.clear();
    queue.clear();
    await settle();
    expect(published.map(event => event.state.upcoming.map(item => item.song.id))).toEqual([["c", "b"], []]);
    await harness.distube.dispose();
  });

  it("publishes nothing for a pause the Player rejects", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const published = updates(harness.distube);
    player.pause.mockRejectedValueOnce(new Error("mixer offline"));

    await expect(queue.pause()).rejects.toMatchObject({ code: "VOICE_FAILED" });
    await settle();
    expect(published).toEqual([]);

    await queue.pause();
    await settle();
    expect(published.map(event => event.state.status)).toEqual(["paused"]);
    await harness.distube.dispose();
  });

  it("publishes one update for a jump over several items, holding every skipped item in history", async () => {
    const { harness, queue } = await playing(["a", "b", "c", "d"]);
    const published = updates(harness.distube);

    await queue.jump(3);
    await settle();

    expect(published.map(event => [event.state.current?.song.id, event.state.status])).toEqual([
      [undefined, "preparing"],
      ["d", "preparing"],
      ["d", "playing"],
    ]);
    expect(published.map(event => songs(event.state.history))).toEqual([
      ["a", "b", "c"],
      ["a", "b", "c"],
      ["a", "b", "c"],
    ]);
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
  it.each([
    ["a plain Error", new Error("cannot start"), "wrapped"],
    ["DisTubeError INVALID_STATE", new DisTubeError("INVALID_STATE", "Player is busy"), "wrapped"],
    ["DisTubeError ABORTED", new DisTubeError("ABORTED", "start cancelled"), "wrapped"],
    ["DisTubeError UNSUPPORTED", new DisTubeError("UNSUPPORTED", "codec unsupported"), "unchanged"],
  ] as const)(
    "fails the item whose start the Player rejected with %s, then plays the next one on the same Player",
    async (_kind, rejection, published) => {
      const harness = playableSetup();
      const player = new FakePlayer();
      player.play.mockRejectedValueOnce(rejection);
      harness.engine.createPlayer.mockResolvedValueOnce(player);
      const events = record(harness.distube, ["queue.item.failed", "queue.item.started"]);
      const failures: DisTubeError[] = [];
      harness.distube.on("queue.item.failed", event => failures.push(event.error));

      const { queue } = await harness.distube.play(TARGET, "a");
      await queue.add("b");
      await settle();

      expect(events).toEqual(["queue.item.failed", "queue.item.started"]);
      if (published === "unchanged") expect(failures[0]).toBe(rejection);
      else {
        expect(failures[0]?.code).toBe("VOICE_FAILED");
        expect(failures[0]?.cause).toBe(rejection);
      }
      expect(harness.source.disposed).toEqual(["a"]);
      expect(harness.engine.createPlayer).toHaveBeenCalledTimes(1);
      expect(queue.current?.song.id).toBe("b");
      expect(queue.history).toEqual([]);
      await harness.distube.dispose();
    },
  );

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
