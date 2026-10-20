import { describe, expect, it } from "vitest";
import type { DisTubeError, DisTubeQueue } from "../src";
import type { UrlPlaybackResource } from "../src/integrations";
import {
  capture,
  deferred,
  FakePlayer,
  GUILD,
  playableSetup,
  record,
  required,
  settle,
  VOICE_CHANNEL,
} from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

/** Every queue event, so a test can assert what published after `queue.deleted`. */
const QUEUE_EVENTS = [
  "queue.created",
  "queue.item.added",
  "queue.playlist.added",
  "queue.item.started",
  "queue.item.finished",
  "queue.item.failed",
  "queue.history.added",
  "queue.finished",
  "queue.autoplay.failed",
  "queue.deleted",
] as const;

const clip = (): UrlPlaybackResource => ({ kind: "url", url: "https://clip.example/direct", dispose: () => undefined });

async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const queue = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.add(id);
  await settle();
  return { harness, queue, player: harness.engine.players[0] as FakePlayer };
}

const waiting = (queue: DisTubeQueue): string[] => queue.upcoming.map(item => item.song.id);

describe("deletion is terminal for queue decisions", () => {
  it.each(["skip", "jump", "previous"] as const)(
    "joins %s cleanup and disposes its former active resource when stop deletes the queue",
    async mode => {
      const { harness, queue, player } = await playing(["a", "b", "c"]);
      if (mode === "previous") {
        player.finish();
        await settle();
      }
      const active = required(queue.current);
      const log = record(harness.distube, QUEUE_EVENTS);
      const stop = player.gate("stop");
      const advance = capture(mode === "skip" ? queue.skip() : mode === "jump" ? queue.jump(1) : queue.previous());
      await stop.entered;

      let settled = false;
      const stopping = queue.stop().then(() => {
        settled = true;
      });
      await settle();
      const settledBeforeStop = settled;
      const disposedBeforeStop = harness.source.disposed.includes(active.song.id);
      stop.resolve();
      await stopping;
      const outcome = await advance;
      await settle();

      expect(settledBeforeStop).toBe(false);
      expect(disposedBeforeStop).toBe(false);
      expect(outcome).toMatchObject({ code: "INVALID_STATE" });
      expect(harness.source.disposed.filter(id => id === active.song.id)).toEqual([active.song.id]);
      expect(log).toEqual(["queue.deleted"]);
      await harness.distube.dispose();
      expect(harness.source.disposed.filter(id => id === active.song.id)).toEqual([active.song.id]);
    },
  );

  it("commits nothing from an advance suspended on a Player effect", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    const log = record(harness.distube, QUEUE_EVENTS);
    const stop = player.gate("stop");

    // Park the advance inside `stopTrack`, exactly where deletion used to interleave.
    const advance = capture(queue.skip());
    await stop.entered;

    // Terminal authority is accepted synchronously, so `queue.deleted` publishes before the
    // suspended advance can resume. Awaiting stop first would deadlock on the held gate.
    const stopping = capture(queue.stop());
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    await Promise.resolve();
    expect(log.at(-1)).toBe("queue.deleted");

    // Releasing the backend resumes the suspended advance, which must commit nothing.
    stop.resolve();
    await settle();
    await stopping;

    expect(log.at(-1)).toBe("queue.deleted");
    expect(log.filter(name => name === "queue.item.finished")).toHaveLength(0);
    expect(log.filter(name => name === "queue.history.added")).toHaveLength(0);
    // `a` started before recording began, and the superseded advance never starts `b`.
    expect(log.filter(name => name === "queue.item.started")).toHaveLength(0);
    expect(queue.history).toEqual([]);
    expect(((await advance) as DisTubeError).code).toBe("INVALID_STATE");
  });

  it("rejects an in-flight pause and commits no status after deletion", async () => {
    const { queue, player } = await playing(["a"]);
    const pause = player.gate("pause");

    const paused = capture(queue.pause());
    await pause.entered;
    const stopping = capture(queue.stop());

    pause.resolve();
    await settle();
    await stopping;

    expect(queue.status).toBe("idle");
    expect(((await paused) as DisTubeError).code).toBe("INVALID_STATE");
  });

  it("commits a voice volume effect that resumes after the queue deleted", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const volume = player.gate("volume:42");

    const applied = capture(harness.distube.voices.get(GUILD)?.setVolume(42) ?? Promise.reject(new Error("no voice")));
    await volume.entered;
    const stopping = capture(queue.stop());
    volume.resolve();
    await settle();
    await stopping;

    expect(await applied).toBeUndefined();
    // Volume belongs to the DisTubeVoice: the effect commits even though the queue deleted mid-flight.
    expect(harness.distube.voices.get(GUILD)?.volume).toBe(42);
  });

  it("drops queued decisions that were waiting behind terminal authority", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    const log = record(harness.distube, QUEUE_EVENTS);
    const stop = player.gate("stop");

    const first = capture(queue.skip());
    await stop.entered;
    // Queued behind the suspended advance, so it has not started deciding yet.
    const second = capture(queue.pause());

    const stopping = capture(queue.stop());
    stop.resolve();
    await settle();
    await stopping;

    expect(((await first) as DisTubeError).code).toBe("INVALID_STATE");
    expect(((await second) as DisTubeError).code).toBe("INVALID_STATE");
    expect(log.at(-1)).toBe("queue.deleted");
  });
});

describe("queue termination frees the voice synchronously", () => {
  it("queue.stop detaches before any await so a direct play in the same tick is accepted", async () => {
    const { harness, queue } = await playing(["a"]);
    const voice = required(harness.distube.voices.get(GUILD));
    const queueLog = record(harness.distube, QUEUE_EVENTS);
    const started: (string | undefined)[] = [];
    harness.distube.on("voice.track.started", event => started.push(event.itemId));

    const stopping = queue.stop();
    const direct = voice.play(clip());
    await expect(direct).resolves.toBeUndefined();
    await stopping;
    await settle();

    expect(started).toEqual([undefined]);
    expect(queueLog).toEqual(["queue.deleted"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("natural exhaustion detaches before cleanup settles", async () => {
    const { harness, player } = await playing(["a"]);
    const voice = required(harness.distube.voices.get(GUILD));
    const queueLog = record(harness.distube, QUEUE_EVENTS);
    const started: (string | undefined)[] = [];
    harness.distube.on("voice.track.started", event => started.push(event.itemId));
    const direct = deferred<ReturnType<typeof capture<void>>>();
    // The listener runs while the queue's terminal cleanup is still pending: the detach already happened.
    harness.distube.on("queue.finished", () => {
      expect(harness.distube.getQueue(GUILD)).toBeUndefined();
      direct.resolve(capture(voice.play(clip())));
    });

    player.finish();
    await settle();

    expect(await direct.promise).toBeUndefined();
    expect(started).toEqual([undefined]);
    expect(queueLog.slice(0, 3)).toEqual(["queue.item.finished", "queue.history.added", "queue.finished"]);
    expect(queueLog.at(-1)).toBe("queue.deleted");
    expect(queueLog.filter(name => name === "queue.item.started")).toHaveLength(0);
  });
});

describe("insertion reconciles the in-flight attempt", () => {
  it.each(["clear", "remove", "jump"] as const)(
    "%s waits for the retired activation's stop before disposing its source",
    async edit => {
      const harness = playableSetup();
      const player = new FakePlayer();
      harness.engine.gateCreate().resolve(player);
      const play = player.gate("play");
      const queue = await harness.distube.play(TARGET, "a");
      const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
      await queue.add("b");
      await play.entered;
      const stop = player.gate("stop");
      const log = record(harness.distube, ["queue.item.started", "queue.item.finished"]);

      if (edit === "clear") await queue.clear();
      else if (edit === "remove") await queue.remove(required(items[0]).id);
      else await queue.jump(2);
      play.resolve();
      await stop.entered;
      await settle();
      const disposedBeforeStop = [...harness.source.disposed];
      stop.resolve();
      await settle();

      expect(disposedBeforeStop).toEqual([]);
      expect(harness.source.disposed.filter(id => id === "a")).toEqual(["a"]);
      expect(log).toEqual(edit === "clear" ? [] : ["queue.item.started"]);
      expect(queue.current?.song.id).toBe(edit === "clear" ? undefined : "b");
      await harness.distube.dispose();
      expect(harness.source.disposed.filter(id => id === "a")).toEqual(["a"]);
    },
  );

  it("supersedes an attempt whose item a head insertion displaced", async () => {
    const { harness, queue, player } = await playing(["a", "b"]);
    // Gates are keyed by occurrence ID, so hold the next play generically: it is `b`'s activation.
    const play = player.gate("play");
    await queue.skip();
    // `b` is inside the Player's play acknowledgement; inserting `c` ahead of it supersedes that attempt.
    await play.entered;

    const [inserted] = await queue.add("c", { next: true });
    expect(waiting(queue)[0]).toBe("c");
    play.resolve();
    await settle();

    expect(queue.current?.id).toBe(required(inserted).id);
    expect(player.playing).toBe(required(inserted).id);
    expect(harness.source.disposed.filter(id => id === "b")).toEqual(["b"]);
    // The accepted play for `b` was stopped before `c` started on the same Player.
    const plays = player.calls.filter(call => call.startsWith("play:"));
    expect(plays).toHaveLength(3);
    const stops = player.calls.map((call, index) => (call === "stop" ? index : -1)).filter(index => index >= 0);
    // First stop ended `a` for the skip; the second ended `b`'s accepted play before `c` started.
    expect(stops).toHaveLength(2);
    expect(stops[1]).toBeGreaterThan(player.calls.indexOf(plays[1] as string));
    expect(stops[1]).toBeLessThan(player.calls.indexOf(plays[2] as string));
    // The displaced occurrence is still waiting; it lost its turn, not its place in the queue.
    expect(waiting(queue)).toEqual(["b"]);
  });

  it("leaves a running attempt alone when insertion appends to the tail", async () => {
    const { queue, player } = await playing(["a"]);
    const started = player.requests.length;

    await queue.add("z");
    await settle();

    // A tail insertion changes no decision about the current item.
    expect(player.requests.length).toBe(started);
    expect(queue.current?.song.id).toBe("a");
    expect(waiting(queue)).toEqual(["z"]);
  });
});
