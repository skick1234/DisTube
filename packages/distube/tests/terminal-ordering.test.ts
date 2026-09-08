import { describe, expect, it } from "vitest";
import type { DisTubeError, DisTubeGuild } from "../src";
import {
  capture,
  type FakePlayer,
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
  "queue.finished",
  "queue.autoplay.failed",
  "queue.deleted",
] as const;

async function playing(ids: readonly string[]) {
  const harness = playableSetup();
  const { queue } = await harness.distube.play(TARGET, ids[0] as string);
  for (const id of ids.slice(1)) await queue.enqueue(id);
  await settle();
  return { harness, queue, player: harness.engine.players[0] as FakePlayer };
}

const waiting = (queue: DisTubeGuild): string[] => queue.state.upcoming.map(item => item.song.id);

describe("deletion is terminal for queue decisions", () => {
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
    // `a` started before recording began, and the superseded advance never starts `b`.
    expect(log.filter(name => name === "queue.item.started")).toHaveLength(0);
    expect(((await advance) as DisTubeError).code).toBe("INVALID_STATE");
  });

  it("keeps queue.deleted last when a paused control settles afterwards", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const log = record(harness.distube, QUEUE_EVENTS);
    const pause = player.gate("pause");

    const paused = capture(queue.pause());
    await pause.entered;
    const stopping = capture(queue.stop());

    pause.resolve();
    await settle();
    await stopping;

    expect(log.at(-1)).toBe("queue.deleted");
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
    // Volume belongs to the DisTubeVoice now: the effect commits even though the queue deleted mid-flight.
    expect(harness.distube.voices.get(GUILD)?.settings.volume).toBe(42);
  });

  it("keeps queue.deleted last when a voice volume effect settles afterwards", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const log = record(harness.distube, QUEUE_EVENTS);
    const volume = player.gate("volume:42");

    const applied = capture(harness.distube.voices.get(GUILD)?.setVolume(42) ?? Promise.reject(new Error("no voice")));
    await volume.entered;
    const stopping = capture(queue.stop());
    volume.resolve();
    await settle();
    await stopping;

    expect(log.at(-1)).toBe("queue.deleted");
    expect(await applied).toBeUndefined();
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

describe("insertion reconciles the in-flight attempt", () => {
  it("supersedes an attempt whose item a head insertion displaced", async () => {
    const { harness, queue, player } = await playing(["a"]);
    const play = player.gate("play");

    // `b` is acquiring the Player; inserting `c` ahead of it must supersede that attempt.
    const enqueued = queue.enqueue("b");
    await settle();
    await queue.skip().catch(() => undefined);
    await play.entered;

    const [inserted] = await queue.enqueue("c");
    await queue.move(required(inserted).id, required(queue.state.upcoming[0]).id);
    play.resolve();
    await settle();
    await enqueued;

    // The queue keeps making progress rather than wedging on the displaced attempt.
    expect(harness.engine.players[0]?.playing).toBeDefined();
    expect(waiting(queue)).not.toContain(queue.state.current?.song.id);
  });

  it("leaves a running attempt alone when insertion appends to the tail", async () => {
    const { queue, player } = await playing(["a"]);
    const started = player.requests.length;

    await queue.enqueue("z");
    await settle();

    // A tail insertion changes no decision about the current item.
    expect(player.requests.length).toBe(started);
    expect(queue.state.current?.song.id).toBe("a");
    expect(waiting(queue)).toEqual(["z"]);
  });
});
