import { describe, expect, it } from "vitest";
import type { DisTubeQueue, QueueItem, Song } from "../src";
import type { PlaybackResource } from "../src/integrations";
import {
  capture,
  deferred,
  deletions,
  FakePlayer,
  flushMicrotasks,
  GUILD,
  media,
  mediaUrl,
  playableSetup,
  record,
  required,
  settle,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

const QUEUE_EVENTS = [
  "queue.created",
  "queue.item.added",
  "queue.playlist.added",
  "queue.item.started",
  "queue.item.finished",
  "queue.item.failed",
  "queue.finished",
  "queue.autoplay.failed",
  "queue.deleted",
] as const;

async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const queue = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.add(id);
  await settle();
  return { harness, queue, player: harness.engine.player };
}

describe("commit races", () => {
  it("registers one queue and one voice join for racing play calls", async () => {
    const harness = playableSetup();
    const [first, second] = await Promise.all([harness.distube.play(TARGET, "a"), harness.distube.play(TARGET, "b")]);
    await settle();

    expect(second).toBe(first);
    expect(harness.distube.queues.size).toBe(1);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
    expect(harness.engine.players).toHaveLength(1);
    expect(first.current?.song.id).toBe("a");
    expect(first.upcoming.map(item => item.song.id)).toEqual(["b"]);
  });

  it("keeps an exhausted queue alive while an admitted add resolves", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const events = record(harness.distube, ["queue.finished", "queue.deleted"]);
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const late = capture(queue.add(mediaUrl("b")));

    player.finish();
    await settle();
    resolution.resolve(media("source", "b"));
    await settle();

    expect(await late).toHaveLength(1);
    expect(harness.distube.getQueue(GUILD)).toBe(queue);
    expect(events).toEqual([]);
    expect(player.played).toEqual(["a", "b"]);
  });
});

describe("edits during preparation", () => {
  it.each([
    ["move", (queue: DisTubeQueue, a: QueueItem): void => queue.move(a.id), ["b"], ["c", "a"]],
    ["remove", (queue: DisTubeQueue, a: QueueItem): void => void queue.remove(a.id), ["b"], ["c"]],
    ["clear", (queue: DisTubeQueue): void => void queue.clear(), [], []],
    ["skip", (queue: DisTubeQueue): void => void queue.skip(), ["b"], ["c"]],
  ] as const)(
    "aborts a preparation that %s displaced, disposes its late resource once and plays only the new head",
    async (_edit, edit, played, upcoming) => {
      const harness = playableSetup();
      const preparation = deferred<PlaybackResource>();
      let signal: AbortSignal | undefined;
      harness.source.stream.mockImplementationOnce(async (_song, options) => {
        signal = options.signal;
        return preparation.promise;
      });
      const queue = await harness.distube.play(TARGET, "a");
      await queue.add("b");
      await queue.add("c");
      await settle();
      const a = required(queue.upcoming[0]);

      edit(queue, a);
      expect(signal?.aborted).toBe(true);
      preparation.resolve(harness.source.resource("a"));
      await settle();

      expect(harness.source.disposed).toEqual(["a"]);
      expect(harness.engine.players.flatMap(player => player.played)).toEqual(played);
      expect(queue.history).toEqual([]);
      expect(queue.upcoming.map(item => item.song.id)).toEqual(upcoming);
    },
  );

  it("keeps preparing when the edit leaves the item first", async () => {
    const harness = playableSetup();
    const preparation = deferred<PlaybackResource>();
    let signal: AbortSignal | undefined;
    harness.source.stream.mockImplementationOnce(async (_song, options) => {
      signal = options.signal;
      return preparation.promise;
    });
    const queue = await harness.distube.play(TARGET, "a");
    await queue.add("b");
    await queue.add("c");
    await settle();

    queue.remove(2);
    await queue.add("z");
    expect(signal?.aborted).toBe(false);
    preparation.resolve(harness.source.resource(required(queue.upcoming[0]).song.id));
    await settle();
    expect(harness.engine.player.played).toEqual(["a"]);
    expect(queue.upcoming.map(item => item.song.id)).toEqual(["c", "z"]);
  });

  it("leaves the running item alone when an insertion appends to the tail", async () => {
    const { queue, player } = await playing(["a"]);
    await queue.add("z");
    await settle();
    expect(player.played).toEqual(["a"]);
    expect(queue.current?.song.id).toBe("a");
    expect(queue.upcoming.map(item => item.song.id)).toEqual(["z"]);
  });
});

describe("stop overlaps", () => {
  it("rejects a pending play when stop arrives before its insertion", async () => {
    const { harness, queue } = await playing(["seed"]);
    const resolution = deferred<Song>();
    harness.source.resolve.mockReturnValueOnce(resolution.promise);
    const events = record(harness.distube, ["queue.item.added", "queue.item.started", "queue.deleted"]);
    const outcome = capture(harness.distube.play(TARGET, mediaUrl("slow")));

    await Promise.resolve();
    const stopping = queue.stop();
    resolution.resolve(media("source", "slow"));
    await stopping;
    await settle();

    expect(await outcome).toMatchObject({ code: "INVALID_STATE" });
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(events).toEqual(["queue.deleted"]);
  });

  it("rejects a pending add once its source settles after stop", async () => {
    const { harness, queue } = await playing(["a"]);
    const sourceResult = deferred<readonly Song[]>();
    harness.source.search.mockReturnValueOnce(sourceResult.promise);
    const insertion = capture(queue.add("late"));
    await flushMicrotasks(32);

    await queue.stop();
    sourceResult.resolve([media("source", "late")]);
    expect(await insertion).toMatchObject({ code: "INVALID_STATE" });
    expect(queue.upcoming).toEqual([]);
  });

  it("waits for an in-flight preparation and disposes its late resource once without an item event", async () => {
    const harness = playableSetup();
    const preparation = deferred<PlaybackResource>();
    const preparationStarted = deferred<void>();
    harness.source.stream.mockImplementationOnce(async () => {
      preparationStarted.resolve();
      return preparation.promise;
    });
    const events = record(harness.distube, [
      "queue.item.started",
      "queue.item.finished",
      "queue.item.failed",
      "queue.deleted",
    ]);
    const queue = await harness.distube.play(TARGET, "a");
    await preparationStarted.promise;
    const song = required(queue.upcoming[0]).song;

    let stopped = false;
    const stopping = queue.stop().finally(() => {
      stopped = true;
    });
    await settle();
    expect(stopped).toBe(false);
    preparation.resolve(harness.source.resource(song.id));
    await stopping;

    expect(harness.source.disposed).toEqual([song.id]);
    expect(events).toEqual(["queue.deleted"]);
  });

  it("never reaches the Player when stop lands during the first Player's settings restore", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const volume = player.gate("volume");
    const events = record(harness.distube, ["queue.item.started", "queue.deleted"]);
    const queue = await harness.distube.play(TARGET, "a");
    await volume.entered;

    const stopping = queue.stop();
    volume.resolve();
    await stopping;
    await settle();

    expect(player.played).toEqual([]);
    expect(harness.source.disposed).toEqual(["a"]);
    expect(events).toEqual(["queue.deleted"]);
    await harness.distube.play(TARGET, "later");
    await settle();
    expect(player.played).toEqual(["later"]);
  });

  it.each(["skip", "jump", "previous"] as const)(
    "lets stop after %s wait for the former resource's disposal and start nothing",
    async mode => {
      const harness = playableSetup();
      const disposal = deferred<void>();
      let hold = false;
      harness.source.stream.mockImplementation(async song => ({
        kind: "url",
        url: `https://stream.example/${song.id}`,
        dispose: async () => {
          if (hold) await disposal.promise;
          harness.source.disposed.push(song.id);
        },
      }));
      const queue = await harness.distube.play(TARGET, "a");
      await queue.add("b");
      await queue.add("c");
      await settle();
      const player = harness.engine.player;
      if (mode === "previous") {
        player.finish();
        await settle();
      }
      const current = required(queue.current).song.id;
      const log = record(harness.distube, QUEUE_EVENTS);
      hold = true;

      const advance = capture(mode === "jump" ? queue.jump(1) : mode === "skip" ? queue.skip() : queue.previous());
      let stopped = false;
      const stopping = queue.stop().then(() => {
        stopped = true;
      });
      await settle();
      const stoppedBeforeDisposal = stopped;
      disposal.resolve();
      await stopping;
      await settle();

      expect(stoppedBeforeDisposal).toBe(false);
      expect(await advance).toBeUndefined();
      expect(harness.source.disposed.filter(id => id === current)).toEqual([current]);
      expect(log.at(-1)).toBe("queue.deleted");
      expect(log).not.toContain("queue.item.started");
      expect(log).not.toContain("queue.item.finished");
      expect(player.playing).toBeUndefined();
      expect(player.played.at(-1)).toBe(current);
    },
  );

  it("commits a voice volume change that resumes after the queue was deleted", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const volume = player.gate("volume");
    const voice = required(harness.distube.voices.get(GUILD));

    const applied = capture(voice.setVolume(42));
    await volume.entered;
    const stopping = queue.stop();
    volume.resolve();
    await stopping;

    expect(await applied).toBeUndefined();
    expect(voice.volume).toBe(42);
  });

  it("leaves a deleted queue idle when an in-flight pause is acknowledged afterwards", async () => {
    const { queue, player } = await playing(["a"]);
    const pause = player.gate("pause");
    const paused = capture(queue.pause());
    await pause.entered;
    const stopping = queue.stop();
    pause.resolve();
    await stopping;
    await paused;
    expect(queue.status).toBe("idle");
    await expect(queue.resume()).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("detaches on natural exhaustion before cleanup so a deletion listener can play a new queue", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const log = record(harness.distube, QUEUE_EVENTS);
    const seen: unknown[] = [];
    harness.distube.on("queue.deleted", () => {
      seen.push(harness.distube.getQueue(GUILD));
      void harness.distube.play(TARGET, "next");
    });

    player.finish();
    await settle();

    expect(seen).toEqual([undefined]);
    expect(log.slice(0, 3)).toEqual(["queue.item.finished", "queue.finished", "queue.deleted"]);
    expect(harness.distube.getQueue(GUILD)).not.toBe(queue);
    expect(player.playing).toBe("next");
  });

  it("publishes only queue.deleted when queue.stop ends a playing item", async () => {
    const { harness, queue } = await playing(["a", "b"]);
    const events = record(harness.distube, ["queue.item.finished", "queue.item.failed", "queue.deleted"]);
    await queue.stop();
    await settle();
    expect(events).toEqual(["queue.deleted"]);
  });
});

describe("voice terminal overlaps", () => {
  it("deletes the queue and disconnects once, failing no item, when the session drops before start", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const starting = player.gate("play");
    const events = record(harness.distube, [
      "queue.item.started",
      "queue.item.failed",
      "queue.deleted",
      "voice.disconnected",
    ]);
    await harness.distube.play(TARGET, "a");
    await starting.entered;

    harness.adapter.session.disconnect(new Error("gateway lost"));
    starting.resolve();
    await settle();

    expect(events).toEqual(["queue.deleted", "voice.disconnected"]);
    expect(harness.source.disposed).toEqual(["a"]);
    expect(player.release).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
  });

  it("fails the item VOICE_FAILED when restoring settings onto the new Player fails, then plays on a fresh Player", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const cause = new Error("volume boom");
    player.setVolume.mockRejectedValueOnce(cause);
    const failures: unknown[] = [];
    harness.distube.on("queue.item.failed", event => void failures.push(event.error));

    const queue = await harness.distube.play(TARGET, "a");
    await queue.add("b");
    await settle();

    expect(failures).toMatchObject([{ code: "VOICE_FAILED", cause }]);
    expect(player.played).toEqual([]);
    expect(player.release).toHaveBeenCalledTimes(1);
    expect(harness.engine.player).not.toBe(player);
    expect(harness.engine.player.playing).toBe("b");
  });

  it("disposes once and releases once when stop and leave overlap", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const voice = required(queue.voice);
    await Promise.all([queue.stop(), voice.leave()]);
    expect(harness.source.disposed).toEqual(["a"]);
    expect(player.release).toHaveBeenCalledTimes(1);
    expect(harness.adapter.session.release).toHaveBeenCalledTimes(1);
  });

  it("joins an in-flight stop and disposes plugins only after every queue and voice settles", async () => {
    const harness = playableSetup();
    const other = { guildId: "other", id: VOICE_CHANNEL };
    const queue = await harness.distube.play(TARGET, "a");
    await harness.distube.play(other, "b");
    await settle();
    const order: string[] = [];
    harness.source.dispose.mockImplementation(() => void order.push("plugin.dispose"));
    for (const session of harness.adapter.sessions)
      session.release.mockImplementation(async () => void order.push("session.release"));
    harness.distube.on("queue.deleted", () => void order.push("queue.deleted"));

    const stopping = queue.stop();
    await harness.distube.dispose();
    await stopping;
    await settle();

    expect(harness.distube.queues.size).toBe(0);
    expect(harness.distube.voices.size).toBe(0);
    expect(order.filter(step => step === "queue.deleted")).toHaveLength(2);
    expect(order.indexOf("plugin.dispose")).toBeGreaterThan(order.lastIndexOf("session.release"));
    await expect(harness.distube.play(TARGET, "c")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("pending work", () => {
  it.each([
    ["resolves", "b", undefined],
    ["fails", undefined, "finished"],
  ] as const)(
    "parks the driver after the last item while a step is pending, then continues when it %s",
    async (_name, next, reason) => {
      const { harness, queue, player } = await playing(["a"]);
      const held = deferred<readonly Song[]>();
      harness.source.search.mockImplementationOnce(() => held.promise);
      const adding = capture(queue.add("b"));
      await settle();
      const events = record(harness.distube, ["queue.finished"]);
      const reasons = deletions(harness.distube);
      player.finish();
      await settle();
      expect(events).toEqual([]);
      expect(harness.distube.getQueue(GUILD)).toBe(queue);

      if (next) held.resolve([media("source", next)]);
      else held.reject(new Error("search down"));
      await adding;
      await settle();
      expect(player.playing).toBe(next);
      expect(events).toEqual(reason ? ["queue.finished"] : []);
      expect(reasons).toEqual(reason ? [reason] : []);
    },
  );

  it("starts the first item while a later step is still resolving", async () => {
    const harness = playableSetup();
    const held = deferred<readonly Song[]>();
    harness.source.search.mockImplementationOnce(async query => [media("source", query)]);
    harness.source.search.mockImplementationOnce(() => held.promise);
    const started = harness.distube.play(TARGET, "a");
    const adding = required(harness.distube.getQueue(GUILD)).add("b");
    await started;
    await settle();
    expect(harness.engine.player.playing).toBe("a");
    held.resolve([media("source", "b")]);
    await adding;
  });

  it("keeps a queue's steps independent of a deleted queue's step for the same guild", async () => {
    const harness = playableSetup();
    const held = deferred<readonly Song[]>();
    const first = await harness.distube.play(TARGET, "a");
    await settle();
    harness.source.search.mockImplementationOnce(() => held.promise);
    const stale = capture(first.add("b"));
    await settle();
    await first.stop();

    const replacement = await harness.distube.play(TARGET, "c");
    await settle();
    expect(harness.engine.player.playing).toBe("c");
    held.resolve([media("source", "b")]);
    expect(await stale).toMatchObject({ code: "INVALID_STATE" });
    expect(replacement.upcoming).toEqual([]);
  });
});
