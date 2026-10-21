import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough, Readable } from "node:stream";
import { AudioPlayerStatus, StreamType } from "@discordjs/voice";
import type { EngineSettings, PlaybackResource, Player, TrackEnd } from "distube/integrations";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../src/engine";
import { DiscordVoiceSession } from "../src/session";
import { bitrate, createMedia, fileReader, type MediaFixtures, peak, sourcePackets, take } from "./support/media";
import { audioPlayerError, CHANNEL, gatewayAdapter, latest, native, resetNative, settle } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const servers: ReturnType<typeof createServer>[] = [];
const cleanups: (() => Promise<void>)[] = [];
let media: MediaFixtures;

beforeAll(async () => {
  media = await createMedia();
}, 30_000);
afterAll(() => media.cleanup());
beforeEach(resetNative);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

function file(path = media.opus): PlaybackResource {
  return { kind: "file", path };
}

interface Playing {
  readonly ended: Promise<TrackEnd>;
  readonly started: Promise<void>;
  readonly onStart: ReturnType<typeof vi.fn>;
  readonly controller: AbortController;
}

function play(player: Player, resource: PlaybackResource): Playing {
  const controller = new AbortController();
  const { promise: started, resolve } = Promise.withResolvers<void>();
  const onStart = vi.fn(resolve);
  const ended = player.play(resource, { signal: controller.signal, onStart });
  void ended.catch(() => undefined);
  return { ended, started, onStart, controller };
}

async function createPlayer(
  settings: Partial<EngineSettings> = {},
  channelBitrate: (channelId: string) => number = () => 384_000,
): Promise<{ player: Player; session: DiscordVoiceSession }> {
  const session = await DiscordVoiceSession.connect({
    guildId: "guild",
    channelId: CHANNEL,
    clientUserId: "bot",
    adapterCreator: gatewayAdapter().creator,
    selfDeaf: true,
    selfMute: false,
    timeoutMs: 50,
    channelBitrate,
  });
  const engine = new DiscordVoiceEngine({ opusComplexity: 10, bufferMs: 500, ...settings });
  const player = await engine.createPlayer(session);
  cleanups.push(
    () => player.release(),
    () => session.release(),
  );
  return { player, session };
}

describe("local Player", () => {
  it("rejects seek without a track, ends a stopped track as stopped and plays another after it", async () => {
    const { player } = await createPlayer();
    await expect(player.seek(1)).rejects.toMatchObject({ code: "INVALID_STATE" });

    const first = play(player, file());
    await first.started;
    await player.pause();
    expect(latest.player.state.status).toBe(AudioPlayerStatus.Paused);
    await player.resume();
    expect(latest.player.state.status).toBe(AudioPlayerStatus.Playing);
    const input = latest.resource.input;
    await player.stopTrack();

    await expect(first.ended).resolves.toEqual({ reason: "stopped" });
    expect(input.destroyed).toBe(true);
    const second = play(player, file());
    await second.started;
    expect(latest.player.play).toHaveBeenCalledTimes(2);
    await player.release();
    await expect(second.ended).resolves.toEqual({ reason: "stopped" });
    await expect(player.play(file(), { signal: new AbortController().signal, onStart: vi.fn() })).rejects.toMatchObject(
      {
        code: "INVALID_STATE",
      },
    );
  });

  it("rejects an encoded resource with UNSUPPORTED and leaves the current track playing", async () => {
    const { player } = await createPlayer();
    const current = play(player, file(media.hour));
    await current.started;
    const dispose = vi.fn();

    const encoded = play(player, { kind: "encoded", format: "lavalink", encoded: "track", dispose });

    await expect(encoded.ended).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(latest.resource.input.destroyed).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(await take(latest.resource.input, 5)).toHaveLength(5);
  });

  it("hands Discord the source Opus packets, starts once and finishes after the last one and Idle", async () => {
    const { player } = await createPlayer();
    const dispose = vi.fn();
    const track = play(player, { kind: "file", path: media.opus, dispose });
    await track.started;

    expect(latest.resource.inputType).toBe(StreamType.Opus);
    const sent = await take(latest.resource.input, Number.POSITIVE_INFINITY);
    const source = await sourcePackets(media.opus);
    expect(sent.every((packet, index) => packet.equals(source[index] as Buffer))).toBe(true);
    expect(sent).toHaveLength(source.length);
    expect(player.position).toBeGreaterThan(5.5);

    latest.player.transition({ status: AudioPlayerStatus.Idle });
    latest.player.transition({ status: AudioPlayerStatus.Idle });

    await expect(track.ended).resolves.toEqual({ reason: "finished" });
    expect(track.onStart).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("settles the first track as replaced before a second play hands Discord its track", async () => {
    const { player } = await createPlayer();
    const first = play(player, file(media.hour));
    await first.started;
    const firstInput = latest.resource.input;

    const second = play(player, file());
    const handedBeforeReplaced = await first.ended.then(end => ({ end, handed: native.resources.length }));
    await second.started;

    expect(handedBeforeReplaced).toEqual({ end: { reason: "replaced" }, handed: 1 });
    expect(firstInput.destroyed).toBe(true);
    expect(native.resources).toHaveLength(2);
  });

  it("aborts a second play's predecessor while it is still opening", async () => {
    const { promise: arrived, resolve: requested } = Promise.withResolvers<void>();
    const server = createServer(() => requested());
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/audio`;
    const { player } = await createPlayer();
    const opening = play(player, { kind: "url", url });
    await arrived;

    const second = play(player, file());

    await expect(opening.ended).resolves.toEqual({ reason: "replaced" });
    await second.started;
    expect(opening.onStart).not.toHaveBeenCalled();
    expect(native.resources).toHaveLength(1);
  });

  it.each([
    ["before it started", false],
    ["while it plays", true],
  ])("ends a track whose signal aborts %s as stopped", async (_stage, afterStart) => {
    const { player } = await createPlayer();
    const track = play(player, file(media.hour));
    if (afterStart) await track.started;

    track.controller.abort();

    await expect(track.ended).resolves.toEqual({ reason: "stopped" });
    expect(track.onStart).toHaveBeenCalledTimes(afterStart ? 1 : 0);
    expect(native.resources.every(resource => resource.input.destroyed)).toBe(true);
  });

  it.each([
    [100, 5],
    [1000, 50],
  ])("reads %i ms ahead as %i packets", async (bufferMs, packets) => {
    const { player } = await createPlayer({ bufferMs });
    const track = play(player, file(media.hour));
    await track.started;
    const input = latest.resource.input;

    input.read(0);
    await vi.waitFor(() => expect(input.readableLength).toBe(packets));
    await new Promise(resolve => setTimeout(resolve, 100));
    const full = input.readableLength;
    await take(input, 3);
    await vi.waitFor(() => expect(input.readableLength).toBe(packets));
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(full).toBe(packets);
    expect(input.readableLength).toBe(packets);
  });

  it("encodes at the channel bitrate, follows a move and then a setBitrate target, each from the next frame", async () => {
    const { player, session } = await createPlayer({ bufferMs: 100 }, channelId =>
      channelId === CHANNEL ? 96_000 : 64_000,
    );
    const track = play(player, file(media.aac));
    await track.started;
    const input = latest.resource.input;
    const measure = async (): Promise<number> => {
      await take(input, 15);
      return bitrate(await take(input, 60));
    };

    const inChannel = await measure();
    await session.join("other");
    const moved = await measure();
    await player.setBitrate?.(48_000);
    const targeted = await measure();

    for (const [measured, expected] of [
      [inChannel, 96_000],
      [moved, 64_000],
      [targeted, 48_000],
    ] as const) {
      expect(measured).toBeGreaterThan(0.85 * expected);
      expect(measured).toBeLessThanOrEqual(1.1 * expected);
    }
  });

  it("rejects play when Discord stops consuming and goes Idle before the track ends, then plays another", async () => {
    const { player } = await createPlayer();
    const first = play(player, file(media.hour));
    await first.started;
    await take(latest.resource.input, 5);

    latest.player.transition({ status: AudioPlayerStatus.Idle });
    latest.player.transition({ status: AudioPlayerStatus.Idle });

    await expect(first.ended).rejects.toThrow("stopped before the track ended");
    const second = play(player, file());
    await second.started;
    expect(latest.player.play).toHaveBeenCalledTimes(2);
  });

  it("rejects play when Discord goes Idle while the final packets of an ended input are unplayed", async () => {
    const { player } = await createPlayer();
    const track = play(player, file());
    await track.started;
    const source = await sourcePackets(media.opus);
    await take(latest.resource.input, source.length - 3);
    await vi.waitFor(() => expect(latest.resource.input.readableLength).toBe(3));
    await settle();

    latest.player.transition({ status: AudioPlayerStatus.Idle });

    await expect(track.ended).rejects.toThrow("stopped before the track ended");
    expect(latest.resource.input.readableEnded).toBe(false);
  });

  it("rejects play without starting when Discord goes Idle before it took the track", async () => {
    const { player } = await createPlayer();
    latest.player.play.mockImplementation((resource: unknown) =>
      latest.player.transition({ status: AudioPlayerStatus.Buffering, resource }),
    );
    const track = play(player, file(media.hour));
    await vi.waitFor(() => expect(latest.player.play).toHaveBeenCalled());

    latest.player.transition({ status: AudioPlayerStatus.Idle });

    await expect(track.ended).rejects.toThrow("stopped before the track ended");
    expect(track.onStart).not.toHaveBeenCalled();
  });

  it("rejects play once on a native audio error without exposing its resource", async () => {
    const { player } = await createPlayer();
    const track = play(player, file());
    await track.started;
    const nativeError = audioPlayerError(latest.resource, new Error("native decode failed"));

    latest.player.emit("error", nativeError);
    latest.player.emit("error", nativeError);

    const failure = await track.ended.then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe("native decode failed");
    expect(failure).not.toBe(nativeError);
    expect(Reflect.get(failure as Error, "resource")).toBeUndefined();
  });

  it("rejects a play still opening when the native connection is destroyed", async () => {
    const { player } = await createPlayer();
    const silent = new PassThrough();
    const track = play(player, { kind: "stream", stream: silent });
    await new Promise(resolve => setTimeout(resolve, 50));

    latest.connection.transition({ status: "destroyed" });

    await expect(track.ended).rejects.toThrow("voice connection was destroyed");
    await player.release();
    expect(silent.destroyed).toBe(true);
    expect(native.createAudioResource).not.toHaveBeenCalled();
  });

  it("rejects play and retires when the native connection is destroyed", async () => {
    const { player } = await createPlayer();
    const track = play(player, file());
    await track.started;
    const input = latest.resource.input;

    latest.connection.transition({ status: "destroyed" });

    await expect(track.ended).rejects.toThrow("voice connection was destroyed");
    await player.release();
    expect(input.destroyed).toBe(true);
    await expect(player.setVolume(50)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("rejects play with a safe cause when the stream input fails after start", async () => {
    const { player } = await createPlayer();
    const stream = new PassThrough();
    stream.write((await readFile(media.hour)).subarray(0, 400_000));
    const track = play(player, { kind: "stream", stream });
    await track.started;
    await take(latest.resource.input, 5);

    stream.destroy(new Error("socket reset at /private/audio.webm"));
    await take(latest.resource.input, Number.POSITIVE_INFINITY);

    const failure = await track.ended.then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toContain("Decode failed during read");
    expect(failure?.message).not.toContain("/private/audio.webm");
  });

  it("keeps pause, volume, filters and the native resource across a seek", async () => {
    const { player } = await createPlayer();
    await player.setVolume(40);
    await player.setFilters([{ name: "bassboost", value: 5 }]);
    const track = play(player, file(media.hour));
    await track.started;
    await take(latest.resource.input, 5);
    await player.pause();

    await player.seek(37);

    expect(player.position).toBeGreaterThanOrEqual(37);
    expect(player.position).toBeLessThan(37.1);
    expect(latest.player.state.status).toBe(AudioPlayerStatus.Paused);
    expect(native.createAudioResource).toHaveBeenCalledTimes(1);
    expect(await take(latest.resource.input, 5)).toHaveLength(5);
  });

  it("rejects a filter chain libavfilter cannot build and keeps the committed one for the next track", async () => {
    const engine = {
      filters: { mute: { render: () => "volume=0" }, broken: { render: () => "nonexistent_filter=1" } },
    };
    const { player } = await createPlayer(engine);
    const first = play(player, file());
    await first.started;
    await player.setFilters([{ name: "mute" }]);

    await expect(player.setFilters([{ name: "broken" }])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await player.stopTrack();
    const second = play(player, file());
    await second.started;

    expect(await peak((await take(latest.resource.input, 52)).slice(2), media.opus)).toBeLessThan(0.001);
  });

  it("rejects at open a track whose committed filter chain cannot be built", async () => {
    const { player } = await createPlayer({ filters: { broken: { render: () => "nonexistent_filter=1" } } });
    await player.setFilters([{ name: "broken" }]);

    const track = play(player, file());

    await expect(track.ended).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(native.createAudioResource).not.toHaveBeenCalled();
  });

  it("applies a filter to a running one-shot stream and refuses to seek it before native effects", async () => {
    const { player } = await createPlayer();
    const stream = new PassThrough();
    stream.write((await readFile(media.hour)).subarray(0, 400_000));
    const track = play(player, { kind: "stream", stream });
    await track.started;
    await take(latest.resource.input, 5);

    await player.setFilters([{ name: "echo" }]);
    await expect(player.seek(2)).rejects.toMatchObject({ code: "UNSUPPORTED" });

    expect(await take(latest.resource.input, 20)).toHaveLength(20);
    expect(latest.player.play).toHaveBeenCalledTimes(1);
    expect(stream.destroyed).toBe(false);
    await player.release();
    expect(stream.destroyed).toBe(true);
  });

  it("keeps the old input playing when a seek cannot open its target", async () => {
    const reader = await fileReader(media.hour, start =>
      start > 0
        ? new Readable({
            read() {
              this.destroy(new Error("range failed"));
            },
          })
        : undefined,
    );
    const { player } = await createPlayer();
    const track = play(player, reader.resource);
    await track.started;
    await take(latest.resource.input, 100);

    await expect(player.seek(20 * 60)).rejects.toThrow();

    expect(player.position).toBeLessThan(3);
    expect(await take(latest.resource.input, 10)).toHaveLength(10);
  });

  it("fences a pending seek when the track stops and joins its input", async () => {
    const stalls: PassThrough[] = [];
    let stalling = false;
    const reader = await fileReader(media.hour, start => {
      if (!stalling || start === 0) return undefined;
      const stalled = new PassThrough();
      stalls.push(stalled);
      return stalled;
    });
    const { player } = await createPlayer();
    const track = play(player, reader.resource);
    await track.started;
    await take(latest.resource.input, 5);
    stalling = true;

    const seeking = player.seek(40 * 60).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(stalls.length).toBeGreaterThan(0));
    await player.stopTrack();

    expect(await seeking).toBeInstanceOf(Error);
    await expect(track.ended).resolves.toEqual({ reason: "stopped" });
    expect(latest.player.play).toHaveBeenCalledTimes(1);
    expect(reader.readables.every(readable => readable.destroyed)).toBe(true);
  });

  it("ends a pending URL as stopped on release and joins it without late native playback", async () => {
    let respond: ((body: Buffer) => void) | undefined;
    const { promise: arrived, resolve: requested } = Promise.withResolvers<void>();
    const server = createServer((_request, response) => {
      respond = body => {
        response.writeHead(200);
        response.end(body);
      };
      requested();
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/audio`;
    const body = await readFile(media.opus);
    const { player } = await createPlayer();
    const track = play(player, { kind: "url", url });
    await arrived;

    const leaving = player.release();
    respond?.(body);

    await expect(track.ended).resolves.toEqual({ reason: "stopped" });
    await leaving;
    expect(native.createAudioResource).not.toHaveBeenCalled();
    expect(latest.player.play).not.toHaveBeenCalled();
  });
});
