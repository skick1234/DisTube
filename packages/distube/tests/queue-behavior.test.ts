import { describe, expect, it } from "vitest";
import { type DisTubeError, type DisTubeGuild, Playlist, type Song } from "../src";
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
  const { queue } = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.enqueue(id);
  await settle();
  const voice = harness.distube.voices.get(GUILD);
  return {
    harness,
    queue,
    voice: voice as NonNullable<typeof voice>,
    player: harness.engine.players[0] as FakePlayer,
  };
}

const waiting = (queue: DisTubeGuild): string[] => queue.state.upcoming.map(item => item.song.id);

describe("repeat modes", () => {
  it("replays a naturally finished occurrence for Song and re-queues it for Queue", async () => {
    const { harness, queue, voice, player } = await playing(["a", "b"]);

    await voice.setRepeat("song");
    player.finish();
    await settle();
    expect(queue.state.current?.song.id).toBe("a");
    expect(waiting(queue)).toEqual(["b"]);

    await voice.setRepeat("queue");
    player.finish();
    await settle();
    expect(queue.state.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual(["a"]);
    await harness.distube.dispose();
  });

  it("bypasses repeat when the caller ends the occurrence", async () => {
    const { harness, queue, voice } = await playing(["a", "b"]);
    await voice.setRepeat("song");

    await queue.skip();
    await settle();

    expect(voice.settings.repeat).toBe("song");
    expect(queue.state.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
    await harness.distube.dispose();
  });
});

describe("autoplay", () => {
  it("continues with a related Song once the queue runs out", async () => {
    const { harness, queue, voice, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(media("source", "related"));

    await voice.setAutoplay(true);
    player.finish();
    await settle();

    expect(voice.settings.autoplay).toBe(true);
    expect(queue.state.current?.song.id).toBe("related");
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
  });

  it("drops a related lookup that a committed user enqueue outran", async () => {
    const { harness, queue, voice, player } = await playing(["a"]);
    const lookup = deferred<Song | undefined>();
    harness.source.related.mockReturnValueOnce(lookup.promise);
    await voice.setAutoplay(true);

    player.finish();
    await settle();
    await queue.enqueue("b");
    await settle();
    lookup.resolve(media("source", "related"));
    await settle();

    expect(queue.state.current?.song.id).toBe("b");
    expect(waiting(queue)).toEqual([]);
  });

  it("reports a failed lookup against its seed, then exhausts the queue", async () => {
    const { harness, voice, player } = await playing(["a"]);
    harness.source.related.mockResolvedValue(undefined);
    const events = record(harness.distube, ["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    const failures: { song: Song; error: DisTubeError }[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push({ song: event.song, error: event.error }));
    await voice.setAutoplay(true);

    player.finish();
    await settle();

    expect(events).toEqual(["queue.autoplay.failed", "queue.finished", "queue.deleted"]);
    expect(failures).toMatchObject([{ song: { id: "a" }, error: { code: "SOURCE_FAILED" } }]);
    // Nothing threw, so there is nothing to blame: no placeholder Error stands in for a cause.
    expect(failures[0]?.error.cause).toBeUndefined();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("publishes the provider's own Error as the cause when the lookup rejects", async () => {
    const { harness, voice, player } = await playing(["a"]);
    const provider = new Error("provider refused");
    harness.source.related.mockRejectedValue(provider);
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    await voice.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures[0]?.code).toBe("SOURCE_FAILED");
    expect(failures[0]?.cause).toBe(provider);
  });

  it("publishes no cause when the owning source has no related member", async () => {
    const { harness, voice, player } = await playing(["a"]);
    // A SourcePlugin that never implements autoplay, rather than one that declines.
    Reflect.deleteProperty(harness.source, "related");
    const failures: DisTubeError[] = [];
    harness.distube.on("queue.autoplay.failed", event => failures.push(event.error));
    await voice.setAutoplay(true);

    player.finish();
    await settle();

    expect(failures[0]?.code).toBe("SOURCE_FAILED");
    expect(failures[0]?.cause).toBeUndefined();
  });

  it("retires a pending lookup when autoplay is disabled on the DisTubeVoice", async () => {
    const { harness, voice, player } = await playing(["a"]);
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
    await voice.setAutoplay(true);

    player.finish();
    await started.promise;
    await voice.setAutoplay(false);

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
      "queue.item.started",
      "queue.item.finished",
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

    // The Playlist's own Songs publish no per-item added events.
    expect(events).toEqual([
      "queue.created",
      "queue.playlist.added",
      "queue.item.started",
      "queue.item.finished",
      "queue.item.started",
      "queue.item.finished",
      "queue.finished",
      "queue.deleted",
    ]);
  });
});

describe("queue occurrence edits and lifetime", () => {
  it("moves and removes only upcoming occurrence IDs", async () => {
    const { harness, queue } = await playing(["a", "b", "c", "d"]);
    const [b, , d] = queue.state.upcoming;
    await queue.move(required(d).id, required(b).id);
    expect(waiting(queue)).toEqual(["d", "b", "c"]);
    await queue.remove(required(b).id);
    expect(waiting(queue)).toEqual(["d", "c"]);
    expect(queue.state.current?.song.id).toBe("a");
    await expect(queue.remove(required(b).id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.move(required(queue.state.current).id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await harness.distube.dispose();
  });

  it("retains volume repeat and autoplay while clearing filters on deletion", async () => {
    const { harness, queue, voice, player } = await playing(["a"]);
    await voice.setVolume(40);
    await voice.setRepeat("queue");
    await voice.setAutoplay(true);
    await voice.setFilters(["bassboost"]);
    const stopped = queue.stop();
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(voice.settings.filters).toEqual(["bassboost"]);
    expect(queue.stop()).toBe(stopped);
    await stopped;
    expect(player.renders.at(-1)).toEqual([]);
    expect(voice.settings).toEqual({ volume: 40, repeat: "queue", autoplay: true, filters: [] });
    const replacement = await harness.distube.play(TARGET, "b");
    expect(replacement.queue).not.toBe(queue);
    await expect(queue.pause()).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.enqueue("c")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(harness.distube.getQueue(GUILD)).toBe(replacement.queue);
    await harness.distube.voices.leave(GUILD);
    const fresh = await harness.distube.voices.join(TARGET);
    expect(fresh.settings).toEqual({ volume: 100, repeat: "off", autoplay: false, filters: [] });
    await harness.distube.dispose();
  });
});
