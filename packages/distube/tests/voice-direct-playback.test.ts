import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { DisTubeEventName } from "../src";
import type { PlaybackResource } from "../src/integrations";
import {
  FakeEngine,
  FakePlayer,
  FakeSource,
  GUILD,
  media,
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

function clip(id = "clip"): PlaybackResource {
  return { kind: "url", url: `https://stream.example/${id}`, dispose: () => undefined };
}

function errorText(value: unknown): string {
  if (!(value instanceof Error)) return "";
  return [
    value.name,
    value.message,
    value.stack ?? "",
    errorText(value.cause),
    ...(value instanceof AggregateError ? value.errors.map(errorText) : []),
  ].join("\n");
}

describe("direct playback without a queue", () => {
  it("publishes only voice track events, without an itemId, and reads position 0 after the track ends", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const order = record(harness.distube, ["voice.track.started", "voice.track.finished", ...QUEUE_EVENTS]);
    const started = vi.fn();
    const finished = vi.fn();
    harness.distube.on("voice.track.started", started);
    harness.distube.on("voice.track.finished", finished);

    await voice.play(clip());
    const player = required(harness.engine.players[0]) as FakePlayer;
    player.position = 12;
    await settle();
    expect(voice.position).toBe(12);

    player.finish();
    await settle();

    expect(order).toEqual(["voice.track.started", "voice.track.finished"]);
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ guildId: GUILD, voice }));
    expect(started.mock.calls[0]?.[0]).not.toHaveProperty("itemId");
    expect(finished.mock.calls[0]?.[0]).not.toHaveProperty("itemId");
    expect(voice.position).toBe(0);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("rejects an undeclared resource kind with UNSUPPORTED before any backend command", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);

    await expect(
      voice.play({
        kind: "encoded",
        format: "test.encoded",
        encoded: "QAAAjQIAJVJpY2sgQXN0bGV5",
        dispose: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED" });

    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
  });

  it("rejects a malformed resource with INVALID_ARGUMENT", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const dispose = vi.fn();

    await expect(voice.play({ kind: "url", url: "not a url", dispose })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(dispose).not.toHaveBeenCalled();
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
  });

  it("consumes a valid resource before rejecting play on a released voice", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    await voice.leave();
    const dispose = vi.fn();

    await expect(voice.play({ kind: "url", url: "https://stream.example/late", dispose })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
  });

  it("claims a one-shot readable across wrappers without disposing the duplicate", async () => {
    class StreamEngine extends FakeEngine {
      override readonly accepts = new Set(["stream" as const]);
    }
    const harness = setup([], { engine: new StreamEngine() });
    const voice = await harness.distube.voices.join(channel);
    const stream = Readable.from(["audio"]);
    const firstDispose = vi.fn();
    const duplicateDispose = vi.fn();
    const first = { kind: "stream" as const, stream, dispose: firstDispose };

    await voice.play(first);
    await expect(voice.play({ kind: "stream", stream, dispose: duplicateDispose })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(duplicateDispose).not.toHaveBeenCalled();
    expect(required(harness.engine.players[0]).playing).toBeDefined();

    await voice.stop();
    expect(stream.destroyed).toBe(true);
    expect(firstDispose).toHaveBeenCalledTimes(1);
    await expect(voice.play(first)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(firstDispose).toHaveBeenCalledTimes(1);
  });

  it("releases a Player that rejects stop before disposing its borrowed resource", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const disposalOrder: string[] = [];
    await voice.play({
      kind: "url",
      url: "https://stream.example/first",
      dispose: () => {
        disposalOrder.push("resource");
      },
    });
    const player = required(harness.engine.players[0]);
    player.stopTrack.mockImplementationOnce(async () => {
      throw new Error("stop failed");
    });
    player.release.mockImplementationOnce(async () => {
      disposalOrder.push("player");
    });

    await expect(voice.stop()).rejects.toMatchObject({ code: "VOICE_FAILED" });
    expect(disposalOrder).toEqual(["player", "resource"]);

    await voice.play(clip("next"));
    expect(harness.engine.players).toHaveLength(2);
  });

  it.each([
    {
      name: "URL and header",
      secret: "Bearer private-header",
      resource: {
        kind: "url" as const,
        url: "https://stream.example/audio?X-Amz-Signature=private-query",
        headers: { Authorization: "Bearer private-header" },
      },
    },
    {
      name: "file",
      secret: "/private/audio/file-token.mp3",
      resource: { kind: "file" as const, path: "/private/audio/file-token.mp3" },
    },
    {
      name: "encoded",
      secret: "ENCODED_PRIVATE_TOKEN",
      resource: { kind: "encoded" as const, format: "test.encoded", encoded: "ENCODED_PRIVATE_TOKEN" },
    },
  ])("redacts nested Player start failures for a $name resource", async ({ resource, secret }) => {
    class ResourceEngine extends FakeEngine {
      override readonly accepts = new Set(["url", "file", "encoded"] as const);
      readonly encodedFormats = new Set(["test.encoded"]);
    }
    const engine = new ResourceEngine();
    const harness = setup([], { engine });
    const voice = await harness.distube.voices.join(channel);
    const pendingPlayer = engine.gateCreate();
    const player = new FakePlayer();
    player.play.mockRejectedValueOnce(
      new Error(`decoder could not open ${secret}`, {
        cause: new AggregateError([new Error(`codec failed for ${secret}`)], "decoder causes"),
      }),
    );

    const playing = voice.play(resource);
    pendingPlayer.resolve(player);
    const failure = await playing.catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(errorText(failure)).toContain("codec failed");
    expect(errorText(failure)).not.toContain(secret);
    if (resource.kind === "url") expect(errorText(failure)).not.toContain(resource.url);
    await voice.leave();
  });

  it("redacts Player outcome and stop cleanup failures using the accepted file path", async () => {
    class FileEngine extends FakeEngine {
      override readonly accepts = new Set(["file"] as const);
    }
    const harness = setup([], { engine: new FileEngine() });
    const voice = await harness.distube.voices.join(channel);
    const path = "/private/audio/accepted-file.mp3";
    const failed = vi.fn();
    harness.distube.on("voice.track.failed", failed);
    await voice.play({ kind: "file", path });
    const player = required(harness.engine.players[0]);
    player.emit({
      type: "failed",
      itemId: "direct",
      error: new Error("decode failed", { cause: new Error(`Could not read ${path}`) }),
    });
    await settle();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(errorText(failed.mock.calls[0]?.[0]?.error)).toContain("Could not read");
    expect(errorText(failed.mock.calls[0]?.[0]?.error)).not.toContain(path);

    await voice.play({
      kind: "file",
      path,
      dispose: () => {
        throw new Error(`dispose failed for ${path}`);
      },
    });
    player.stopTrack.mockRejectedValueOnce(new Error(`stop failed for ${path}`));
    player.release.mockRejectedValueOnce(new Error(`release failed for ${path}`));
    const failure = await voice.stop().catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(errorText(failure)).toContain("stop failed");
    expect(errorText(failure)).toContain("dispose failed");
    expect(errorText(failure)).not.toContain(path);
  });

  it("rejects track controls with INVALID_STATE while a queue is attached and leaves its item alone", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(channel, "a");
    const items = [...(queue.current ? [queue.current] : []), ...queue.upcoming];
    await settle();
    const voice = required(harness.distube.voices.get(GUILD));
    const player = required(harness.engine.players[0]) as FakePlayer;
    const events = record(harness.distube, ["voice.track.started", "voice.track.finished", "queue.item.finished"]);

    for (const control of [
      () => voice.play(clip()),
      () => voice.stop(),
      () => voice.pause(),
      () => voice.resume(),
      () => voice.seek(5),
    ]) {
      await expect(control()).rejects.toMatchObject({ code: "INVALID_STATE" });
    }
    await settle();

    expect(queue.current?.id).toBe(items[0]?.id);
    expect(player.playing).toBe(items[0]?.id);
    expect(player.calls.filter(call => call !== "volume:100" && !call.startsWith("play:"))).toEqual([]);
    expect(events).toEqual([]);
  });

  it("stops and releases the queue's track before a direct play in the same tick as queue.stop and keeps the direct track playing", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(channel, "a");
    await settle();
    const queued = required(queue.current).id;
    const voice = required(harness.distube.voices.get(GUILD));
    const player = required(harness.engine.players[0]) as FakePlayer;
    const events = record(
      harness.distube,
      QUEUE_EVENTS.filter(name => name !== "queue.deleted"),
    );
    const tracks: (string | undefined)[] = [];
    const finished: (string | undefined)[] = [];
    harness.distube.on("voice.track.started", event => tracks.push(event.itemId));
    harness.distube.on("voice.track.finished", event => finished.push(event.itemId));

    // The stop's own queue.deleted is the last queue event; the direct track must add none after it.
    const stopping = queue.stop();
    const playing = voice.play(clip("after-stop"));
    await Promise.all([stopping, playing]);
    await settle();

    // A stale queue stop that lands after the direct play would silence the new track.
    expect(player.calls.filter(call => call === "stop" || call.startsWith("play:"))).toEqual([
      `play:${queued}`,
      "stop",
      `play:${player.requests.at(-1)?.itemId}`,
    ]);
    expect(player.requests.at(-1)?.resource).toMatchObject({ url: "https://stream.example/after-stop" });
    expect(player.playing).toBe(player.requests.at(-1)?.itemId);
    expect(tracks).toEqual([undefined]);
    expect(finished).toEqual([queued]);
    expect(harness.source.disposed).toEqual(["a"]);
    expect(events).toEqual([]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  });

  it("rejects stop, pause, resume and seek with INVALID_STATE when no track is active", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);

    for (const control of [() => voice.stop(), () => voice.pause(), () => voice.resume(), () => voice.seek(1)]) {
      await expect(control()).rejects.toMatchObject({ code: "INVALID_STATE" });
    }

    await voice.play(clip());
    required(harness.engine.players[0]).finish();
    await settle();
    await expect(voice.pause()).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(required(harness.engine.players[0]).pause).not.toHaveBeenCalled();
  });

  it("rejects seek with INVALID_STATE before checking capabilities for attached, idle and released voices", async () => {
    const harness = setup([new FakeSource("source")], { engine: new FakeEngine(undefined, { seek: false }) });
    const voice = await harness.distube.voices.join(channel);
    await expect(voice.seek(10)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const queue = await harness.distube.play(channel, media("source", "a"));
    await settle();
    const player = required(harness.engine.players[0]);

    await expect(voice.seek(10)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(queue.seek(10)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await voice.leave();
    await expect(voice.seek(10)).rejects.toMatchObject({ code: "INVALID_STATE" });

    expect(player.seek).not.toHaveBeenCalled();
  });

  it("rejects seek with UNSUPPORTED before touching the Player when the engine cannot seek", async () => {
    const harness = setup([], { engine: new FakeEngine(undefined, { seek: false }) });
    const voice = await harness.distube.voices.join(channel);
    await voice.play(clip());
    const player = required(harness.engine.players[0]) as FakePlayer;

    await expect(voice.seek(10)).rejects.toMatchObject({ code: "UNSUPPORTED" });

    expect(player.seek).not.toHaveBeenCalled();
    expect(player.playing).toBeDefined();
    await harness.distube.dispose();
  });

  it("ends an active direct track before starting the next one", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const order: string[] = [];
    harness.distube.on("voice.track.started", event => order.push(`started:${event.itemId}`));
    harness.distube.on("voice.track.finished", event => order.push(`finished:${event.itemId}`));

    await voice.play(clip("a"), { itemId: "a" });
    await voice.play(clip("b"), { itemId: "b" });
    await settle();
    const player = required(harness.engine.players[0]) as FakePlayer;

    expect(player.calls).toEqual(["volume:100", "play:a", "stop", "play:b"]);
    expect(player.playing).toBe("b");
    expect(order).toEqual(["started:a", "finished:a", "started:b"]);
  });
});

describe("leave from the voice facade", () => {
  it("joins and leaves without publishing queue events or creating a Player", async () => {
    const harness = playableSetup();
    const events = record(harness.distube, ["voice.disconnected", ...QUEUE_EVENTS]);
    const voice = await harness.distube.voices.join(channel);
    expect(events).toEqual([]);
    await voice.leave();

    expect(events).toEqual(["voice.disconnected"]);
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
    expect(required(harness.adapter.sessions[0]).release).toHaveBeenCalledTimes(1);
  });

  it("deletes the attached queue, releases Player before session, announces once, and repeats as a no-op", async () => {
    const harness = playableSetup();
    const queue = await harness.distube.play(channel, "a");
    await settle();
    const voice = required(harness.distube.voices.get(GUILD));
    const player = required(harness.engine.players[0]);
    const session = required(harness.adapter.sessions[0]);
    const order: string[] = [];
    player.release.mockImplementation(async () => {
      order.push("player.release");
    });
    session.release.mockImplementation(async () => {
      order.push("session.release");
    });
    harness.distube.on("queue.deleted", () => order.push("queue.deleted"));
    harness.distube.on("voice.disconnected", event => order.push(`voice.disconnected:${event.reason}`));

    const first = voice.leave();
    const second = voice.leave();
    await Promise.all([first, second]);
    await settle();

    expect(order).toEqual(["queue.deleted", "player.release", "session.release", "voice.disconnected:left"]);
    expect(queue.status).toBe("idle");
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.has(GUILD)).toBe(false);

    // A released voice's leave is a successful no-op and cannot touch a successor voice.
    const successor = await harness.distube.voices.join(channel);
    await expect(voice.leave()).resolves.toBeUndefined();
    expect(harness.distube.voices.get(GUILD)).toBe(successor);
    expect(session.release).toHaveBeenCalledTimes(1);
    await expect(voice.play(clip())).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
