import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { DisTubeEventName } from "../src";
import type { PlaybackResource } from "../src/integrations";
import {
  capture,
  type FakePlayer,
  FixedBitratePlayer,
  GUILD,
  playableSetup,
  record,
  required,
  settle,
  setup,
  VOICE_CHANNEL,
} from "./support/harness";

const channel = { guildId: GUILD, id: VOICE_CHANNEL };

const QUEUE_EVENTS: readonly DisTubeEventName[] = [
  "queue.created",
  "queue.item.added",
  "queue.item.started",
  "queue.item.finished",
  "queue.item.failed",
  "queue.history.added",
  "queue.finished",
  "queue.deleted",
];

function clip(id = "clip", dispose: () => void = () => undefined): PlaybackResource {
  return { kind: "url", url: `https://stream.example/${id}`, dispose };
}

async function joined() {
  const harness = setup([]);
  const voice = await harness.distube.voices.join(channel);
  return { harness, voice };
}

describe("direct playback", () => {
  it("resolves finished at the natural end, calls onStart once and publishes no queue event", async () => {
    const { harness, voice } = await joined();
    const events = record(harness.distube, QUEUE_EVENTS);
    const onStart = vi.fn();
    const dispose = vi.fn();

    const playing = voice.play(clip("clip", dispose), { onStart });
    await settle();
    const player = harness.engine.player;
    player.position = 12;
    expect(voice.position).toBe(12);
    expect(onStart).toHaveBeenCalledTimes(1);

    player.finish();
    expect(await playing).toEqual({ reason: "finished" });
    expect(voice.position).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    await settle();
    expect(events).toEqual([]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("rejects VOICE_FAILED when the track fails after start and stays connected", async () => {
    const { harness, voice } = await joined();
    const playing = capture(voice.play(clip()));
    await settle();
    const failure = new Error("input ended early");
    harness.engine.player.fail(failure);
    expect(await playing).toMatchObject({ code: "VOICE_FAILED", cause: failure });
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
  });

  it("lets the last play win: the replaced call resolves before the new track is audible", async () => {
    const { harness, voice } = await joined();
    const order: string[] = [];
    const disposed: string[] = [];
    const first = voice.play(clip("a", () => void disposed.push("a")));
    await settle();
    void first.then(end => order.push(`a:${end.reason}`));
    const second = voice.play(
      clip("b", () => void disposed.push("b")),
      { onStart: () => order.push("b:started") },
    );
    await settle();

    expect(order).toEqual(["a:replaced", "b:started"]);
    expect(harness.engine.player.playing).toBe("b");
    harness.engine.player.finish();
    expect(await second).toEqual({ reason: "finished" });
    expect(disposed).toEqual(["a", "b"]);
  });

  it("rejects ABORTED for a signal aborted before start and resolves stopped for one aborted after", async () => {
    const { harness, voice } = await joined();
    const early = new AbortController();
    early.abort();
    const unstarted = vi.fn();
    const onStart = vi.fn();
    await expect(voice.play(clip("early", unstarted), { signal: early.signal, onStart })).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(unstarted).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();

    const late = new AbortController();
    const playing = voice.play(clip("late"), { signal: late.signal });
    await settle();
    late.abort();
    expect(await playing).toEqual({ reason: "stopped" });
    expect(harness.engine.player.playing).toBeUndefined();
  });

  it("ends only the track on stop and destroys a stream resource once", async () => {
    const { harness, voice } = await joined();
    const stream = Readable.from(["audio"]);
    const dispose = vi.fn();
    const playing = voice.play({ kind: "stream", stream, dispose });
    await settle();
    await voice.stop();
    expect(await playing).toEqual({ reason: "stopped" });
    expect(stream.destroyed).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
  });

  it("rejects track controls with INVALID_STATE without a track", async () => {
    const { harness, voice } = await joined();
    for (const control of [() => voice.stop(), () => voice.pause(), () => voice.resume(), () => voice.seek(1)]) {
      await expect(control()).rejects.toMatchObject({ code: "INVALID_STATE" });
    }
    const playing = voice.play(clip());
    await settle();
    harness.engine.player.finish();
    await playing;
    await expect(voice.pause()).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(harness.engine.player.pause).not.toHaveBeenCalled();
  });

  it("forwards pause and resume once each and carries the pause intent across tracks", async () => {
    const { harness, voice } = await joined();
    void voice.play(clip("a"));
    await settle();
    const player = harness.engine.player;
    await voice.pause();
    await voice.pause();
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(voice.paused).toBe(true);

    void voice.play(clip("b"));
    await settle();
    expect(voice.paused).toBe(true);
    await voice.resume();
    await voice.resume();
    expect(player.resume).toHaveBeenCalledTimes(1);
    expect(voice.paused).toBe(false);
  });

  it("seeks only resources whose kind allows it", async () => {
    const { harness, voice } = await joined();
    const stream = Readable.from(["audio"]);
    void voice.play({ kind: "stream", stream });
    await settle();
    const player = harness.engine.player;
    await expect(voice.seek(10)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(player.playing).toBe("stream");

    void voice.play({ kind: "url", url: "https://stream.example/live" });
    await settle();
    await expect(voice.seek(10)).rejects.toMatchObject({ code: "UNSUPPORTED" });

    void voice.play({ kind: "file", path: "/music/a.mp3" });
    await settle();
    await expect(voice.seek(-1)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await voice.seek(10);
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(10);
  });

  it("rejects play on a released voice and still disposes the resource once", async () => {
    const { harness, voice } = await joined();
    await voice.leave();
    const dispose = vi.fn();
    await expect(voice.play(clip("late", dispose))).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
  });
});

describe("direct playback over a queue", () => {
  it("replaces the queue's track, deletes the queue as replaced and keeps the clip playing", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(channel, "a");
    await harness.distube.play(channel, "b");
    await settle();
    const voice = required(queue.voice);
    const events: string[] = [];
    for (const name of QUEUE_EVENTS)
      harness.distube.on(
        name,
        event => void events.push(name === "queue.deleted" && "reason" in event ? `deleted:${event.reason}` : name),
      );

    const playing = voice.play(clip("sfx"));
    await settle();

    expect(events).toEqual(["deleted:replaced"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.engine.player.playing).toBe("sfx");
    expect(harness.source.disposed).toEqual(["a"]);
    harness.engine.player.finish();
    expect(await playing).toEqual({ reason: "finished" });
  });

  it("rejects skip on the queue a direct clip replaced and keeps the clip playing", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(channel, "a");
    await harness.distube.play(channel, "b");
    await settle();
    void required(queue.voice).play(clip("sfx"));
    await settle();

    await expect(queue.skip()).rejects.toMatchObject({ code: "INVALID_STATE" });
    await settle();
    expect(harness.engine.player.playing).toBe("sfx");
    expect(harness.engine.player.played).toEqual(["a", "sfx"]);
  });

  it("keeps a move committed when the caller aborts the insertion after the join", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(channel, "a");
    await settle();
    const controller = new AbortController();
    const session = harness.adapter.session;
    session.join.mockImplementationOnce(async channelId => {
      session.channelId = channelId;
      controller.abort();
    });
    const events = record(harness.distube, QUEUE_EVENTS);

    await expect(
      harness.distube.play({ guildId: GUILD, id: "second" }, "b", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    await settle();

    expect(harness.source.search).toHaveBeenLastCalledWith("b", expect.anything());
    expect(queue.voice?.channelId).toBe("second");
    expect(harness.engine.player.playing).toBe("a");
    expect(queue.upcoming).toEqual([]);
    expect(events).toEqual([]);
  });

  it("treats a direct stop as a skip and a direct pause as the queue's pause", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(channel, "a");
    await harness.distube.play(channel, "b");
    await settle();
    const voice = required(queue.voice);
    const events = record(harness.distube, ["queue.item.finished", "queue.history.added", "queue.item.started"]);

    await voice.pause();
    expect(queue.status).toBe("paused");
    await voice.resume();
    expect(queue.status).toBe("playing");

    await voice.stop();
    await settle();
    expect(events).toEqual(["queue.history.added", "queue.item.started"]);
    expect(queue.history.map(item => item.song.id)).toEqual(["a"]);
    expect(queue.current?.song.id).toBe("b");
  });

  it("does not stop a direct track that replaced the queue in the same tick as queue.stop", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(channel, "a");
    await settle();
    const voice = required(queue.voice);
    const stopping = queue.stop();
    const playing = voice.play(clip("after-stop"));
    await stopping;
    await settle();
    expect(harness.engine.player.played).toEqual(["a", "after-stop"]);
    expect(harness.engine.player.playing).toBe("after-stop");
    expect(harness.source.disposed).toEqual(["a"]);
    harness.engine.player.finish();
    expect(await playing).toEqual({ reason: "finished" });
  });
});

describe("bitrate", () => {
  it("commits a numeric override and auto after the live Player acknowledges", async () => {
    const { harness, voice } = await joined();
    expect(voice.bitrate).toBe("auto");
    void voice.play(clip());
    await settle();
    await voice.setBitrate(96_000);
    expect(voice.bitrate).toBe(96_000);
    await voice.setBitrate("auto");
    expect(voice.bitrate).toBe("auto");
    expect(harness.engine.player.bitrates).toEqual([96_000, undefined]);
  });

  it.each([5_999, 512_000, 96_000.5, Number.NaN])("rejects %d with INVALID_ARGUMENT", async bitrate => {
    const { voice } = await joined();
    await expect(voice.setBitrate(bitrate)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(voice.bitrate).toBe("auto");
  });

  it("stores a value set before any Player and applies it before the first track", async () => {
    const { harness, voice } = await joined();
    await voice.setBitrate(64_000);
    expect(voice.bitrate).toBe(64_000);
    void voice.play(clip());
    await settle();
    expect(harness.engine.player.calls.slice(0, 3)).toEqual(["volume:100", "bitrate:64000", "play:clip"]);
  });

  it("keeps the previous setting when the Player rejects or cannot change the bitrate", async () => {
    const { harness, voice } = await joined();
    void voice.play(clip());
    await settle();
    harness.engine.player.setBitrate.mockRejectedValueOnce(new Error("encoder busy"));
    await expect(voice.setBitrate(96_000)).rejects.toMatchObject({ code: "VOICE_FAILED" });
    expect(voice.bitrate).toBe("auto");

    const fixed = setup([]);
    fixed.engine.createPlayer.mockResolvedValueOnce(new FixedBitratePlayer());
    const fixedVoice = await fixed.distube.voices.join(channel);
    await fixedVoice.setBitrate(48_000);
    void fixedVoice.play(clip());
    await settle();
    await expect(fixedVoice.setBitrate(96_000)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(fixedVoice.bitrate).toBe(48_000);
    await fixedVoice.setBitrate("auto");
    expect(fixedVoice.bitrate).toBe("auto");
  });
});

describe("leave from the voice", () => {
  it("joins and leaves without queue events or a Player", async () => {
    const harness = playableSetup();
    const events = record(harness.distube, ["voice.disconnected", ...QUEUE_EVENTS]);
    const voice = await harness.distube.voices.join(channel);
    await voice.leave();
    await settle();
    expect(events).toEqual(["voice.disconnected"]);
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
    expect(harness.adapter.session.release).toHaveBeenCalledTimes(1);
  });

  it("deletes the queue, releases Player before session, announces once and repeats as a no-op", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(channel, "a");
    await settle();
    const voice = required(queue.voice);
    const player = harness.engine.player as FakePlayer;
    const session = harness.adapter.session;
    const order: string[] = [];
    player.release.mockImplementation(async () => void order.push("player.release"));
    session.release.mockImplementation(async () => void order.push("session.release"));
    harness.distube.on("queue.deleted", event => void order.push(`queue.deleted:${event.reason}`));
    harness.distube.on("voice.disconnected", event => void order.push(`voice.disconnected:${event.reason}`));

    let firstSettled = false;
    const first = voice.leave().then(() => (firstSettled = true));
    const second = harness.distube.voices.leave(GUILD).then(() => firstSettled);
    expect(await second).toBe(true);
    await first;
    await settle();

    expect(order).toEqual(["queue.deleted:leave", "player.release", "session.release", "voice.disconnected:left"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.has(GUILD)).toBe(false);

    const successor = await harness.distube.voices.join(channel);
    await expect(voice.leave()).resolves.toBeUndefined();
    expect(harness.distube.voices.get(GUILD)).toBe(successor);
    expect(session.release).toHaveBeenCalledTimes(1);
    await expect(voice.setVolume(50)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
