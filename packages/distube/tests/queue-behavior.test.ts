import { describe, expect, it } from "vitest";
import { type DisTubeError, type DisTubeEventMap, type DisTubeQueue, Playlist, type Song } from "../src";
import {
  deferred,
  type FakePlayer,
  GUILD,
  media,
  playableSetup,
  record,
  required,
  settle,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

/** A playing queue holding `ids` in order: the first is current, the rest are waiting. */
async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const queue = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.add(id);
  await settle();
  const voice = harness.distube.voices.get(GUILD);
  return {
    harness,
    queue,
    voice: voice as NonNullable<typeof voice>,
    player: harness.engine.players[0] as FakePlayer,
  };
}

const waiting = (queue: DisTubeQueue): string[] => queue.upcoming.map(item => item.song.id);

describe("repeat modes", () => {
  it("replays a naturally finished occurrence for Song and re-queues it for Queue", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    const first = required(queue.current);

    await queue.setRepeat("song");
    expect(queue.repeat).toBe("song");
    player.finish();
    await settle();
    expect(queue.current?.song.id).toBe("a");
    // A new occurrence of the same Song, not the ended one.
    expect(queue.current?.id).not.toBe(first.id);
    expect(queue.current?.song).toBe(first.song);
    expect(waiting(queue)).toEqual(["b"]);

    await queue.setRepeat("queue");
    player.finish();
    await settle();
    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual(["a"]);
    await harness.distube.dispose();
  });

  it("bypasses repeat when the caller ends the occurrence", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    await queue.setRepeat("song");

    await queue.skip();
    await settle();

    expect(queue.repeat).toBe("song");
    expect(player.release).not.toHaveBeenCalled();
    expect(harness.engine.players).toEqual([player]);
    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
    await harness.distube.dispose();
  });

  it("does not repeat a failed item in queue mode", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    await queue.setRepeat("queue");
    player.emit({ type: "failed", itemId: required(queue.current).id, error: new Error("decoder failed") });
    await settle();

    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
    expect(queue.history).toEqual([]);
    expect(harness.source.disposed).toEqual(["a"]);
    player.finish();
    await settle();

    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
    expect(player.requests.map(request => request.resource)).toEqual([
      expect.objectContaining({ url: "https://stream.example/a" }),
      expect.objectContaining({ url: "https://stream.example/b" }),
      expect.objectContaining({ url: "https://stream.example/b" }),
    ]);
    await harness.distube.dispose();
  });

  it("rejects an unknown repeat mode and a non-boolean autoplay before committing", async () => {
    const { harness, queue } = await playing(["a"]);
    await expect(queue.setRepeat("forever" as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(queue.setAutoplay("yes" as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect([queue.repeat, queue.autoplay]).toEqual(["off", false]);
    await harness.distube.dispose();
  });
});

describe("autoplay", () => {
  it("continues with a related Song once the queue runs out", async () => {
    const { harness, queue, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(media("source", "related"));

    await queue.setAutoplay(true);
    player.finish();
    await settle();

    expect(queue.autoplay).toBe(true);
    expect(queue.current?.song.id).toBe("related");
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
  });

  it("drops a related lookup that a committed user add outran", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    harness.source.related.mockReturnValueOnce(lookup.promise);
    await queue.setAutoplay(true);

    player.finish();
    await settle();
    await queue.add("b");
    await settle();
    lookup.resolve(media("source", "related"));
    await settle();

    expect(queue.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
  });

  it("reports a failed lookup against its seed, then exhausts the queue", async () => {
    const { harness, queue, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(undefined);
    const events = record(harness.distube, ["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    const failures: { song: Song; error: DisTubeError }[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push({ song: event.song, error: event.error }));
    await queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(events).toEqual(["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    expect(failures).toMatchObject([{ song: { id: "a" }, error: { code: "SOURCE_FAILED" } }]);
    // Nothing threw, so there is nothing to blame: no placeholder Error stands in for a cause.
    expect(failures[0]?.error.cause).toBeUndefined();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("publishes the provider's own Error as the cause when the lookup rejects", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const provider = new Error("provider refused");
    harness.source.related.mockRejectedValue(provider);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    await queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures[0]?.code).toBe("SOURCE_FAILED");
    expect(failures[0]?.cause).toBe(provider);
  });

  it("publishes no cause when the owning source has no related member", async () => {
    const { harness, queue, player } = await playing(["a"]);
    // A SourcePlugin that never implements autoplay, rather than one that declines.
    Reflect.deleteProperty(harness.source, "related");
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    await queue.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures[0]?.code).toBe("SOURCE_FAILED");
    expect(failures[0]?.cause).toBeUndefined();
  });

  it("retires a pending lookup when autoplay is disabled on the queue", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    const started = deferred<void>();
    let signal: AbortSignal | undefined;
    harness.source.related.mockImplementationOnce(async (_song, context) => {
      signal = context.signal;
      started.resolve();
      return lookup.promise;
    });
    const events = record(harness.distube, [
      "queue.finished",
      "queue.deleted",
      "queue.item.added",
      "queue.item.started",
      "queue.autoplay.failed",
    ]);
    await queue.setAutoplay(true);

    player.finish();
    await started.promise;
    await queue.setAutoplay(false);
    await settle();

    expect(signal?.aborted).toBe(true);
    expect(events).toEqual(["queue.finished", "queue.deleted"]);

    lookup.resolve(media("source", "related"));
    await settle();

    expect(events).toEqual(["queue.finished", "queue.deleted"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });
});

describe("event lifecycle", () => {
  it("publishes one ordered lifecycle and commits a Playlist as a single collection", async () => {
    const harness = playableSetup();
    const playlist = new Playlist({
      id: "list",
      name: "List",
      url: "https://source.example/list",
      source: "source",
      songs: [media("source", "x"), media("source", "y")],
    });
    harness.source.resolve.mockResolvedValueOnce(playlist);
    const events = record(harness.distube, [
      "queue.created",
      "queue.playlist.added",
      "queue.item.added",
      "voice.track.started",
      "queue.item.started",
      "voice.track.finished",
      "queue.item.finished",
      "queue.history.added",
      "queue.finished",
      "queue.deleted",
    ]);

    await harness.distube.play(TARGET, playlist.url);
    await settle();
    const player = harness.engine.players[0] as FakePlayer;
    player.finish();
    await settle();
    player.finish();
    await settle();

    // The Playlist's own Songs publish no per-item added events; voice events precede the queue's.
    expect(events).toEqual([
      "queue.created",
      "queue.playlist.added",
      "voice.track.started",
      "queue.item.started",
      "voice.track.finished",
      "queue.item.finished",
      "queue.history.added",
      "voice.track.started",
      "queue.item.started",
      "voice.track.finished",
      "queue.item.finished",
      "queue.history.added",
      "queue.finished",
      "queue.deleted",
    ]);
  });

  it("captures immutable state that does not change after later commits", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    const captures: DisTubeEventMap["queue.item.finished"][] = [];
    harness.distube.on("queue.item.finished", event => captures.push(event));
    await queue.skip();
    await settle();
    player.finish();
    await settle();
    // Read after both commits: a live view would show the later state in the first capture.
    expect(captures.map(event => event.state.upcoming.map(item => item.song.id))).toEqual([["b"], []]);
    expect(Object.isFrozen(captures[0]?.state)).toBe(true);
    await harness.distube.dispose();
  });
});

describe("queue occurrence edits and lifetime", () => {
  it("moves and removes only upcoming occurrence IDs", async () => {
    const { harness, queue } = await playing(["a", "b", "c", "d"]);
    const [b, , d] = queue.upcoming;
    await queue.move(required(d).id, required(b).id);
    expect(waiting(queue)).toEqual(["d", "b", "c"]);
    expect((await queue.remove(required(b).id)).map(item => item.id)).toEqual([b?.id]);
    expect(waiting(queue)).toEqual(["d", "c"]);
    expect(queue.current?.song.id).toBe("a");
    await expect(queue.remove(required(b).id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.move(required(queue.current).id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await harness.distube.dispose();
  });

  it("removes only the named occurrence when the same Song is added twice", async () => {
    const { harness, queue } = await playing(["a"]);
    const song = media("source", "duplicate");
    const first = required((await queue.add(song))[0]);
    const second = required((await queue.add(song))[0]);
    expect(first.song).toBe(song);
    expect(second.song).toBe(song);
    expect(first.id).not.toBe(second.id);

    expect((await queue.remove(first.id)).map(item => item.id)).toEqual([first.id]);
    expect(queue.upcoming.map(item => item.id)).toEqual([second.id]);
    await queue.skip();
    await settle();
    expect(queue.current).toBe(second);
    await harness.distube.dispose();
  });

  it("keeps volume and filters on the voice while repeat and autoplay reset with the queue", async () => {
    const { harness, queue, voice, player } = await playing(["a"]);
    await voice.setVolume(40);
    expect(voice.volume).toBe(40);
    expect(player.volumes.at(-1)).toBe(40);
    expect(player.playing).toBe(queue.current?.id);
    await voice.filters.set("bassboost", 15);
    await queue.setRepeat("queue");
    await queue.setAutoplay(true);
    const rendered = player.renders.length;

    const stopped = queue.stop();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(queue.stop()).toBe(stopped);
    await stopped;

    // Queue deletion is not a filter reset: the committed set and its rendering stay.
    expect(player.renders.length).toBe(rendered);
    expect(voice.volume).toBe(40);
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 15, label: "Bass +15dB" }]);
    expect([queue.repeat, queue.autoplay, queue.history]).toEqual(["off", false, []]);

    const replacement = await harness.distube.play(TARGET, "b");
    expect(replacement).not.toBe(queue);
    expect([replacement.repeat, replacement.autoplay]).toEqual(["off", false]);
    await expect(queue.pause()).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.add("c")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.setRepeat("song")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(harness.distube.getQueue(GUILD)).toBe(replacement);

    await harness.distube.voices.leave(GUILD);
    const fresh = await harness.distube.voices.join(TARGET);
    expect([fresh.volume, fresh.filters.names, fresh.selfDeaf, fresh.selfMute]).toEqual([100, [], true, false]);
    await harness.distube.dispose();
  });
});
