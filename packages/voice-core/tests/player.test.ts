import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough, Readable } from "node:stream";
import { AudioPlayerStatus, StreamType, type VoiceConnection } from "@discordjs/voice";
import type { PlaybackRequest, PlayerEvent } from "distube/integrations";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterRegistry } from "../src/filters";
import { DiscordVoicePlayer } from "../src/player";
import { createMedia, fileReader, type MediaFixtures, peak, sourcePackets, take } from "./support/media";
import { audioPlayerError, FakeConnection, latest, native, resetNative, settle } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const servers: ReturnType<typeof createServer>[] = [];
let media: MediaFixtures;

beforeAll(async () => {
  media = await createMedia();
}, 30_000);
afterAll(() => media.cleanup());
beforeEach(resetNative);
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

function request(itemId = "item", path = media.opus): PlaybackRequest {
  return { itemId, resource: { kind: "file", path } };
}

function createPlayer(filters = new FilterRegistry()): {
  player: DiscordVoicePlayer;
  connection: FakeConnection;
  events: PlayerEvent[];
} {
  const connection = new FakeConnection();
  const player = new DiscordVoicePlayer(connection as unknown as VoiceConnection, filters);
  const events: PlayerEvent[] = [];
  player.subscribe(event => events.push(event));
  return { player, connection, events };
}

describe("local Player", () => {
  it("rejects invalid controls and accepts another track after stop", async () => {
    const { player, events } = createPlayer();
    await expect(player.seek(-1)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(player.seek(1)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(player.setVolume(Number.NaN)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await player.play(request("first"));
    await expect(player.play(request("overlap"))).rejects.toThrow("already has active playback");
    await player.pause();
    expect(latest.player.state.status).toBe(AudioPlayerStatus.Paused);
    await player.resume();
    expect(latest.player.state.status).toBe(AudioPlayerStatus.Playing);
    const first = latest.resource.input;
    await player.stopTrack();
    expect(events).toEqual([]);
    expect(first.destroyed).toBe(true);

    await player.play(request("second"));
    expect(latest.player.play).toHaveBeenCalledTimes(2);
    await player.release();
    await expect(player.play(request("after release"))).rejects.toThrow("retired");
  });

  it("hands Discord the source Opus packets and finishes once after the last one and Idle", async () => {
    const { player, events } = createPlayer();
    await player.play(request("A"));

    expect(latest.resource.inputType).toBe(StreamType.Opus);
    const sent = await take(latest.resource.input, Number.POSITIVE_INFINITY);
    const source = await sourcePackets(media.opus);
    expect(sent.every((packet, index) => packet.equals(source[index] as Buffer))).toBe(true);
    expect(sent).toHaveLength(source.length);
    expect(player.position).toBeGreaterThan(5.5);
    expect(events).toEqual([]);

    latest.player.transition({ status: AudioPlayerStatus.Idle });
    latest.player.transition({ status: AudioPlayerStatus.Idle });
    await settle();
    expect(events).toEqual([{ type: "finished", itemId: "A" }]);
    await player.release();
  });

  it("fails the item once when Discord stops consuming and goes Idle before the track ends", async () => {
    const { player, events } = createPlayer();
    await player.play(request("A", media.hour));
    await take(latest.resource.input, 5);

    latest.player.transition({ status: AudioPlayerStatus.Idle });
    latest.player.transition({ status: AudioPlayerStatus.Idle });
    await settle();

    expect(events).toEqual([
      { type: "failed", itemId: "A", error: expect.objectContaining({ message: expect.stringContaining("stopped") }) },
    ]);
    await player.play(request("B"));
    expect(latest.player.play).toHaveBeenCalledTimes(2);
    await player.release();
  });

  it("fails the item when Discord goes Idle while the final packets of an ended input are unplayed", async () => {
    const { player, events } = createPlayer();
    await player.play(request("A"));
    const source = await sourcePackets(media.opus);
    await take(latest.resource.input, source.length - 3);
    await vi.waitFor(() => expect(latest.resource.input.readableLength).toBe(3));
    await settle();

    latest.player.transition({ status: AudioPlayerStatus.Idle });
    await settle();

    expect(latest.resource.input.readableEnded).toBe(false);
    expect(events).toEqual([
      { type: "failed", itemId: "A", error: expect.objectContaining({ message: expect.stringContaining("stopped") }) },
    ]);
    await player.release();
  });

  it("rejects play when Discord goes Idle before the track started or ended", async () => {
    native.entersState.mockImplementation(() => new Promise(() => undefined));
    const { player, events } = createPlayer();
    const playing = player.play(request("A", media.hour));
    await vi.waitFor(() => expect(latest.player.play).toHaveBeenCalled());

    latest.player.transition({ status: AudioPlayerStatus.Idle });

    await expect(playing).rejects.toThrow("stopped before the track ended");
    expect(events).toEqual([]);
    await player.release();
  });

  it("reports a native audio error once without exposing its resource", async () => {
    const { player, events } = createPlayer();
    player.subscribe(() => {
      throw new Error("listener failed");
    });
    await player.play(request("failure"));
    const nativeError = audioPlayerError(latest.resource, new Error("native decode failed"));

    latest.player.emit("error", nativeError);
    latest.player.emit("error", nativeError);
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "failed", itemId: "failure", error: expect.any(Error) });
    expect((events[0] as { error: Error }).error).not.toBe(nativeError);
    expect(Reflect.get((events[0] as { error: Error }).error, "resource")).toBeUndefined();
    await player.release();
  });

  it("retires on native connection destruction, closes the track and suppresses later outcomes", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("lost"));
    const input = latest.resource.input;

    connection.transition({ status: "destroyed" });
    expect(events).toMatchObject([{ type: "failed", itemId: "lost", terminal: true }]);
    await player.release();
    expect(input.destroyed).toBe(true);
    latest.player.transition({ status: AudioPlayerStatus.Idle });
    await settle();
    expect(events).toHaveLength(1);
  });

  it("reports one failure with a safe cause when the stream input fails after start", async () => {
    const { player, events } = createPlayer();
    const stream = new PassThrough();
    stream.write((await readFile(media.hour)).subarray(0, 400_000));
    await player.play({ itemId: "stream", resource: { kind: "stream", stream } });
    await take(latest.resource.input, 5);

    stream.destroy(new Error("socket reset at /private/audio.webm"));
    await take(latest.resource.input, Number.POSITIVE_INFINITY);
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events[0]).toMatchObject({ type: "failed", itemId: "stream" });
    expect((events[0] as { error: Error }).error.message).not.toContain("/private/audio.webm");
    await player.release();
  });

  it("keeps pause, volume, filters and the native resource across a seek without a track event", async () => {
    const { player, events } = createPlayer();
    await player.setVolume(40);
    await player.setFilters([{ name: "bassboost", value: 5 }]);
    await player.play(request("item", media.hour));
    await take(latest.resource.input, 5);
    await player.pause();

    await player.seek(37);

    expect(player.position).toBeGreaterThanOrEqual(37);
    expect(player.position).toBeLessThan(37.1);
    expect(latest.player.state.status).toBe(AudioPlayerStatus.Paused);
    expect(native.createAudioResource).toHaveBeenCalledTimes(1);
    expect(await take(latest.resource.input, 5)).toHaveLength(5);
    expect(events).toEqual([]);
    await player.release();
  });

  it("keeps the committed chain for the next track when a new chain is rejected", async () => {
    const { player } = createPlayer(
      new FilterRegistry({ mute: { render: () => "volume=0" }, broken: { render: () => "nonexistent_filter=1" } }),
    );
    await player.play(request("first"));
    await player.setFilters([{ name: "mute" }]);

    await expect(player.setFilters([{ name: "broken" }])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await player.stopTrack();
    await player.play(request("second"));

    expect(await peak((await take(latest.resource.input, 52)).slice(2), media.opus)).toBeLessThan(0.001);
    await player.release();
  });

  it("applies a filter to a running one-shot stream and refuses to seek it before native effects", async () => {
    const { player } = createPlayer();
    const stream = new PassThrough();
    stream.write((await readFile(media.hour)).subarray(0, 400_000));
    await player.play({ itemId: "stream", resource: { kind: "stream", stream } });
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
    const { player, events } = createPlayer();
    await player.play({ itemId: "reader", resource: reader.resource });
    await take(latest.resource.input, 100);

    await expect(player.seek(20 * 60)).rejects.toThrow();

    expect(player.position).toBeLessThan(3);
    expect(await take(latest.resource.input, 10)).toHaveLength(10);
    expect(events).toEqual([]);
    await player.release();
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
    const { player, events } = createPlayer();
    await player.play({ itemId: "reader", resource: reader.resource });
    await take(latest.resource.input, 5);
    stalling = true;

    const seeking = player.seek(40 * 60).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(stalls.length).toBeGreaterThan(0));
    await player.stopTrack();

    expect(await seeking).toBeInstanceOf(Error);
    await player.release();
    expect(latest.player.play).toHaveBeenCalledTimes(1);
    expect(reader.readables.every(readable => readable.destroyed)).toBe(true);
    expect(events).toEqual([]);
  });

  it("aborts a pending URL before release and joins it without late native playback", async () => {
    let respond: ((body: Buffer) => void) | undefined;
    let requested!: () => void;
    const arrived = new Promise<void>(resolve => {
      requested = resolve;
    });
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
    const { player } = createPlayer();
    const playing = player.play({ itemId: "late", resource: { kind: "url", url } });
    await arrived;

    const leaving = player.release();
    respond?.(body);
    await expect(playing).rejects.toThrow();
    await leaving;
    expect(native.createAudioResource).not.toHaveBeenCalled();
    expect(latest.player.play).not.toHaveBeenCalled();
  });
});
