import { describe, expect, it, vi } from "vitest";
import type { PlaybackResource } from "../src/integrations";
import { FakePlayer, GUILD, playableSetup, record, required, settle, VOICE_CHANNEL } from "./support/harness";

const TARGET = { guildId: GUILD, id: VOICE_CHANNEL };

function clip(id: string): PlaybackResource {
  return { kind: "url", url: `https://stream.example/${id}`, dispose: () => undefined };
}

describe("a track fenced between its acceptance and its backend acknowledgement", () => {
  it("never reaches the Player when the queue stops during the first Player's settings restore", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const volume = player.gate("volume");
    const events = record(harness.distube, ["voice.track.started", "queue.item.started", "queue.deleted"]);
    const queue = await harness.distube.play(TARGET, "a");
    const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
    await volume.entered;

    const stopping = queue.stop();
    volume.resolve();
    await stopping;
    await settle();

    expect(player.requests).toEqual([]);
    expect(harness.source.disposed).toEqual([required(items[0]).song.id]);
    expect(events).toEqual(["queue.deleted"]);
    expect(harness.distube.voices.get(GUILD)?.position).toBe(0);
    // The voice is free for direct use and the same Player serves it.
    await required(harness.distube.voices.get(GUILD)).play(clip("later"));
    expect(player.requests.map(request => request.itemId)).toHaveLength(1);
  });

  it.each(["finished", "failed"] as const)(
    "drops an early %s outcome and late start when the queue stops before acknowledgement",
    async type => {
      const harness = playableSetup();
      const player = new FakePlayer();
      harness.engine.gateCreate().resolve(player);
      const starting = player.gate("play");
      const events = record(harness.distube, [
        "voice.track.started",
        "voice.track.finished",
        "voice.track.failed",
        "queue.item.started",
        "queue.deleted",
      ]);
      const queue = await harness.distube.play(TARGET, "a");
      const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
      await starting.entered;
      const item = required(items[0]);
      player.emit({ type, itemId: item.id, error: new Error("early failure") });

      const stopping = queue.stop();
      starting.resolve();
      await stopping;
      await settle();

      expect(events).toEqual(["queue.deleted"]);
      expect(harness.source.disposed).toEqual([item.song.id]);
      expect(player.playing).toBeUndefined();
      expect(player.release).not.toHaveBeenCalled();
      const voice = required(harness.distube.voices.get(GUILD));
      await voice.play(clip("later"));
      await voice.leave();
      expect(player.release).toHaveBeenCalledTimes(1);
      expect(required(harness.adapter.sessions[0]).release).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["finished", "failed"] as const)(
    "drops an early %s outcome and late start when a direct voice leaves before acknowledgement",
    async type => {
      const harness = playableSetup();
      const voice = await harness.distube.voices.join(TARGET);
      const player = new FakePlayer();
      harness.engine.gateCreate().resolve(player);
      const starting = player.gate("play");
      const events = record(harness.distube, [
        "voice.track.started",
        "voice.track.finished",
        "voice.track.failed",
        "voice.disconnected",
      ]);
      const playing = voice.play(clip("a"), { itemId: "intro" });
      const rejected = expect(playing).rejects.toMatchObject({ code: "INVALID_STATE" });
      await starting.entered;
      player.emit({ type, itemId: "intro", error: new Error("early failure") });

      const leaving = voice.leave();
      starting.resolve();
      await Promise.all([leaving, rejected]);

      expect(events).toEqual(["voice.disconnected"]);
      expect(player.playing).toBeUndefined();
      expect(player.release).toHaveBeenCalledTimes(1);
      expect(required(harness.adapter.sessions[0]).release).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["finished", "failed"] as const)(
    "publishes started then the early %s outcome once when acknowledgement is still live",
    async type => {
      const harness = playableSetup();
      const voice = await harness.distube.voices.join(TARGET);
      const player = new FakePlayer();
      harness.engine.gateCreate().resolve(player);
      const starting = player.gate("play");
      const events = record(harness.distube, ["voice.track.started", "voice.track.finished", "voice.track.failed"]);
      const playing = voice.play(clip("a"), { itemId: "intro" });
      await starting.entered;
      player.emit({ type, itemId: "intro", error: new Error("early failure") });
      player.emit({ type, itemId: "intro", error: new Error("duplicate") });
      expect(events).toEqual([]);

      starting.resolve();
      await playing;
      player.position = 12;
      player.emit({ type, itemId: "intro", error: new Error("late duplicate") });

      expect(events).toEqual(["voice.track.started", `voice.track.${type}`]);
      expect(voice.position).toBe(0);
      await voice.leave();
      expect(player.release).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["finished", "failed"] as const)("discards an early %s outcome when direct start rejects", async type => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const starting = player.gate("play");
    const events = record(harness.distube, ["voice.track.started", "voice.track.finished", "voice.track.failed"]);
    const dispose = vi.fn();
    const playing = voice.play({ kind: "url", url: "https://stream.example/rejected", dispose }, { itemId: "intro" });
    await starting.entered;
    player.emit({ type, itemId: "intro", error: new Error("early outcome") });

    const cause = new Error("start rejected");
    starting.reject(cause);
    await expect(playing).rejects.toMatchObject({ code: "VOICE_FAILED", cause });
    expect(events).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("commits one queued item failure after an early outcome and rejected start", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const starting = player.gate("play");
    const events = record(harness.distube, ["voice.track.started", "voice.track.finished", "queue.item.failed"]);
    const queue = await harness.distube.play(TARGET, "a");
    const item = required(queue.current ?? queue.upcoming[0]);
    await starting.entered;
    player.emit({ type: "finished", itemId: item.id });

    starting.reject(new Error("start rejected"));
    await settle();
    expect(events).toEqual(["queue.item.failed"]);
    expect(harness.source.disposed).toEqual([item.song.id]);
  });

  it("normalizes a failure anywhere on the direct play path to VOICE_FAILED with its cause once", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const cause = new Error("volume boom");
    player.setVolume.mockRejectedValueOnce(cause);

    await expect(voice.play(clip("a"))).rejects.toMatchObject({ code: "VOICE_FAILED", cause });
    expect(player.requests).toEqual([]);
    expect(voice.position).toBe(0);
    // The Player is intact; the next play restores and starts normally.
    await voice.play(clip("b"), { itemId: "b" });
    expect(player.playing).toBe("b");
  });

  it("reports queue failure without voice track events when the session drops before start", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const starting = player.gate("play");
    const events = record(harness.distube, [
      "voice.track.started",
      "voice.track.failed",
      "queue.item.started",
      "queue.item.failed",
      "queue.deleted",
      "voice.disconnected",
    ]);
    const failed = vi.fn();
    harness.distube.on("voice.track.failed", failed);
    const queue = await harness.distube.play(TARGET, "a");
    const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
    await starting.entered;

    const session = required(harness.adapter.sessions[0]);
    const stopping = player.gate("stop");
    session.disconnect(new Error("gateway lost"));
    await settle();
    const disposedBeforeAcknowledgement = [...harness.source.disposed];
    starting.resolve();
    await stopping.entered;
    const disposedBeforeStop = [...harness.source.disposed];
    stopping.resolve();
    await settle();

    expect(disposedBeforeAcknowledgement).toEqual([]);
    expect(disposedBeforeStop).toEqual([]);
    expect(events).toEqual(["queue.item.failed", "queue.deleted", "voice.disconnected"]);
    expect(failed).not.toHaveBeenCalled();
    expect(harness.source.disposed).toEqual([required(items[0]).song.id]);
    expect(player.stopTrack).toHaveBeenCalled();
    expect(harness.distube.voices.has(GUILD)).toBe(false);
  });

  it("publishes no direct track event when disconnect cancels the start", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    const player = new FakePlayer();
    harness.engine.gateCreate().resolve(player);
    const starting = player.gate("play");
    const events = record(harness.distube, ["voice.track.started", "voice.track.failed", "voice.disconnected"]);
    const playing = voice.play(clip("a"), { itemId: "intro" });
    await starting.entered;

    required(harness.adapter.sessions[0]).disconnect(new Error("gateway lost"));
    await settle();
    starting.resolve();
    await expect(playing).rejects.toMatchObject({ code: "INVALID_STATE" });
    await settle();

    expect(events).toEqual(["voice.disconnected"]);
  });
});

describe("terminal track cleanup precedes source disposal", () => {
  it("waits for the fenced active track's stop before disposing its source", async () => {
    const harness = playableSetup();
    await harness.distube.play(TARGET, "a");
    await settle();
    const player = required(harness.engine.players[0]);
    const stopping = player.gate("stop");

    required(harness.adapter.sessions[0]).disconnect(new Error("gateway lost"));
    await stopping.entered;
    await settle();
    const disposedBeforeStop = [...harness.source.disposed];
    stopping.resolve();
    await settle();

    expect(disposedBeforeStop).toEqual([]);
    expect(harness.source.disposed).toEqual(["a"]);
    expect(player.release).toHaveBeenCalledTimes(1);
  });

  it("still stops a detached track if leave fences the voice before that stop runs", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(TARGET, "a");
    await settle();
    const voice = required(harness.distube.voices.get(GUILD));
    const player = required(harness.engine.players[0]);
    const stop = player.gate("stop");

    const stopping = queue.stop();
    const leaving = voice.leave();
    await settle();
    const disposedBeforeStop = [...harness.source.disposed];
    stop.resolve();
    await Promise.all([stopping, leaving]);

    expect(disposedBeforeStop).toEqual([]);
    expect(harness.source.disposed).toEqual(["a"]);
    expect(player.stopTrack).toHaveBeenCalledTimes(1);
    expect(player.release).toHaveBeenCalledTimes(1);
  });
});

describe("a Player that terminates under a track", () => {
  it("fails the direct track with the backend cause and serves the next play from a fresh Player", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    const failed = vi.fn();
    harness.distube.on("voice.track.failed", failed);
    await voice.play(clip("a"), { itemId: "a" });
    const first = required(harness.engine.players[0]);
    const cause = new Error("decoder lost");

    first.emit({ type: "terminal", error: cause });
    await settle();

    expect(first.release).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "a", error: expect.objectContaining({ code: "VOICE_FAILED", cause }) }),
    );
    expect(voice.position).toBe(0);
    await voice.play(clip("b"), { itemId: "b" });
    expect(harness.engine.players).toHaveLength(2);
    expect(required(harness.engine.players[1]).playing).toBe("b");
  });
});

describe("caller item IDs are correlation, not identity", () => {
  it("ignores a late outcome for an earlier track that reused the same itemId", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(TARGET);
    const finished = vi.fn();
    harness.distube.on("voice.track.finished", finished);
    await voice.play(clip("one"), { itemId: "intro" });
    await voice.stop();
    await voice.play(clip("two"), { itemId: "intro" });
    const player = required(harness.engine.players[0]);
    player.position = 3;

    // The backend reports on the first request, long after it was stopped.
    player.emit({ type: "finished", itemId: required(player.requestIds[0]) });
    await settle();

    expect(finished).toHaveBeenCalledTimes(1);
    expect(voice.position).toBe(3);
    expect(player.requestIds[0]).not.toBe(player.requestIds[1]);
    expect(player.requests.map(request => request.itemId)).toEqual(["intro", "intro"]);
    await voice.stop();
    expect(finished).toHaveBeenCalledTimes(2);
  });
});
