import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { FilterRegistry, Track } from "@distube/voice-core/core";
import type { PlaybackRequest, PlaybackResource, PlayerEvent } from "distube/integrations";
import type { VoiceConnection } from "eris";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMedia, fileReader, type MediaFixtures, sourcePackets } from "../../voice-core/tests/support/media";
import { ErisVoicePlayer } from "../src/player";
import { FakeVoiceConnection } from "./support/eris";

const servers: ReturnType<typeof createServer>[] = [];
let media: MediaFixtures;

beforeAll(async () => {
  media = await createMedia();
}, 30_000);
afterAll(() => media.cleanup());
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

/** Serves `path` over HTTP, answering byte ranges with 206 and recording each request's Range header. */
async function serve(path: string): Promise<{ url: string; ranges: (string | undefined)[] }> {
  const body = await readFile(path);
  const ranges: (string | undefined)[] = [];
  const server = createServer((incoming, response) => {
    ranges.push(incoming.headers.range);
    const match = /^bytes=(\d+)-(\d+)$/.exec(incoming.headers.range ?? "");
    if (!match) {
      response.writeHead(200, { "content-length": String(body.length) });
      response.end(body);
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), body.length - 1);
    response.writeHead(206, {
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${body.length}`,
    });
    response.end(body.subarray(start, end + 1));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/audio`, ranges };
}

async function seekable(kind: "file" | "timed" | "seekable url"): Promise<PlaybackResource> {
  if (kind === "file") return { kind: "file", path: media.hour };
  if (kind === "timed") return { kind: "timed", container: "webm", open: () => createReadStream(media.hour) };
  return { kind: "url", url: (await serve(media.hour)).url, seekable: true };
}

function request(itemId = "item", path = media.opus): PlaybackRequest {
  return { itemId, resource: { kind: "file", path } };
}

function createPlayer(filters = new FilterRegistry()): {
  player: ErisVoicePlayer;
  connection: FakeVoiceConnection;
  events: PlayerEvent[];
} {
  const connection = new FakeVoiceConnection();
  const player = new ErisVoicePlayer(connection as unknown as VoiceConnection, filters);
  const events: PlayerEvent[] = [];
  player.subscribe(event => events.push(event));
  return { player, connection, events };
}

async function oneShot(): Promise<PassThrough> {
  const stream = new PassThrough();
  stream.write((await readFile(media.hour)).subarray(0, 400_000));
  return stream;
}

describe("Eris local Player", () => {
  it("rejects invalid controls and remains reusable after stopping a track", async () => {
    const { player, connection, events } = createPlayer();
    await expect(player.pause()).rejects.toThrow("no active playback");
    await expect(player.resume()).rejects.toThrow("no active playback");
    await expect(player.seek(-1)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(player.seek(5)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(player.setVolume(Number.NaN)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(player.setVolume(-1)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await player.play(request("first"));
    await expect(player.play(request("overlap"))).rejects.toThrow("already has active playback");
    await player.stopTrack();
    await player.play(request("second"));
    expect(connection.play).toHaveBeenCalledTimes(2);
    expect(events).toEqual([]);

    const firstRelease = player.release();
    expect(player.release()).toBe(firstRelease);
    await firstRelease;
    await expect(player.play(request("after release"))).rejects.toThrow("retired");
  });

  it("hands Eris the source Opus packets and finishes once after the last packet and the native stop", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A"));

    expect(connection.play).toHaveBeenCalledWith(expect.anything(), {
      format: "opusPackets",
      frameDuration: 20,
      voiceDataTimeout: 15_000,
    });
    const sent = await connection.send(Number.POSITIVE_INFINITY);
    const packets = await sourcePackets(media.opus);
    expect(sent).toHaveLength(packets.length);
    expect(sent.every((packet, index) => packet.equals(packets[index] as Buffer))).toBe(true);
    expect(player.position).toBeGreaterThan(5.5);

    connection.finishCurrent();
    connection.finishCurrent();
    expect(events).toEqual([{ type: "finished", itemId: "A" }]);
    await player.release();
  });

  it("reports the time of the last packet Eris sent, not of the packets it queued", async () => {
    const { player, connection } = createPlayer();
    await player.play(request("A", media.hour));

    await connection.send(500);
    await connection.queue(30);

    expect(player.position).toBeGreaterThanOrEqual(9.9);
    expect(player.position).toBeLessThanOrEqual(10.1);
    await player.release();
  });

  it("seeks to the start while Eris still sends the final packets, without a track event", async () => {
    const { player, connection, events } = createPlayer();
    const packets = await sourcePackets(media.opus);
    await player.play(request("A"));
    await connection.send(packets.length - 10);
    await connection.queue(10);
    await new Promise(resolve => setTimeout(resolve, 100));

    await player.seek(0);

    expect(events).toEqual([]);
    expect(player.position).toBeLessThan(1);
    expect(await connection.send(Number.POSITIVE_INFINITY)).toHaveLength(packets.length + 10);
    connection.finishCurrent();
    expect(events).toEqual([{ type: "finished", itemId: "A" }]);
    await player.release();
  });

  it("rejects a filter chain the Track cannot build and keeps the committed one", async () => {
    const filters = new FilterRegistry({ broken: { render: () => "nonexistent_filter=1" } });
    const control = createPlayer(filters);
    const subject = createPlayer(filters);
    await control.player.setFilters([{ name: "echo" }]);
    await subject.player.setFilters([{ name: "echo" }]);
    await subject.player.play(request("A"));
    await subject.connection.send(5);

    await expect(subject.player.setFilters([{ name: "broken" }])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await subject.player.stopTrack();
    await subject.player.play(request("B"));
    await control.player.play(request("B"));
    const echoed = await control.connection.send(40);
    expect(await subject.connection.send(40)).toEqual(echoed);
    expect(subject.events).toEqual([]);
    await control.player.release();
    await subject.player.release();
  });

  it("applies volume to the running track without replaying its input", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());
    const packets = await sourcePackets(media.opus);
    const before = await connection.send(10);

    await player.setVolume(50);

    const after = await connection.send(40);
    expect(before.every((packet, index) => packet.equals(packets[index] as Buffer))).toBe(true);
    expect(after.some((packet, index) => !packet.equals(packets[index + 10] as Buffer))).toBe(true);
    expect(connection.play).toHaveBeenCalledTimes(1);
    await player.release();
  });

  it("fails the track once when Eris gives it up before its input ended", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A", media.hour));
    await connection.send(5);

    connection.finishCurrent();

    expect(events).toMatchObject([{ type: "failed", itemId: "A", error: expect.any(Error) }]);
    expect(player.position).toBe(0);
    await player.release();
  });

  it("does not finish a track when Eris stops it while the connection is tearing down", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A"));
    await connection.send(Number.POSITIVE_INFINITY);

    connection.ready = false;
    connection.finishCurrent();

    expect(events).toEqual([]);
    await player.release();
  });

  it.each([
    {
      refusal: "throws from play",
      refuse: () => {
        throw new Error("Not ready yet");
      },
      error: "Not ready yet",
    },
    { refusal: "refuses the source", refuse: () => undefined, error: "could not start the track" },
  ])("rejects play and closes the input when Eris $refusal", async ({ refuse, error }) => {
    const { player, connection, events } = createPlayer();
    const stream = await oneShot();
    connection.play.mockImplementationOnce(refuse);

    await expect(player.play({ itemId: "refused", resource: { kind: "stream", stream } })).rejects.toThrow(error);

    await vi.waitFor(() => expect(stream.destroyed).toBe(true));
    expect(events).toEqual([]);
    await player.play(request("next"));
    await player.release();
  });

  it("closes a Track whose open finishes after the track was stopped and never hands it to Eris", async () => {
    const { player, connection, events } = createPlayer();
    const open = Track.open.bind(Track);
    let opened: Track | undefined;
    let proceed!: () => void;
    const gate = new Promise<void>(resolve => {
      proceed = resolve;
    });
    vi.spyOn(Track, "open").mockImplementationOnce(async (...args) => {
      opened = await open(...args);
      await gate;
      return opened;
    });
    const playing = player.play(request());
    await vi.waitFor(() => expect(opened).toBeDefined());

    await player.stopTrack();
    proceed();

    await expect(playing).rejects.toThrow("superseded");
    expect(opened?.packets.destroyed).toBe(true);
    expect(connection.play).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    vi.restoreAllMocks();
    await player.play(request("next"));
    await player.release();
  });

  it("reapplies pause intent when the next track is handed to Eris", async () => {
    const { player, connection } = createPlayer();
    await player.play(request("A"));
    await player.pause();
    await player.stopTrack();

    await player.play(request("B"));

    expect(connection.play).toHaveBeenCalledTimes(2);
    expect(connection.pause.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      connection.play.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY,
    );
    await player.release();
  });

  it("resumes Eris only from a paused intent", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());

    await player.resume();
    expect(connection.resume).not.toHaveBeenCalled();
    await player.pause();
    await player.resume();

    expect(connection.resume).toHaveBeenCalledTimes(1);
    expect(connection.paused).toBe(false);
    await player.release();
  });

  it("reapplies pause intent after Eris resumes on reconnect", async () => {
    const { player, connection } = createPlayer();
    await player.play(request());
    await player.pause();

    connection.reconnect();
    await Promise.resolve();

    expect(connection.paused).toBe(true);
    await player.release();
  });

  it("ignores a late native stop for a replaced track", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A", media.hour));
    const replaced = connection.current;
    await player.stopTrack();
    await player.play(request("B", media.hour));

    connection.current = replaced;
    connection.finishCurrent();

    expect(events).toEqual([]);
    await expect(player.play(request("C"))).rejects.toThrow("already has active playback");
    await player.release();
  });

  it.each([
    ["file", "volume"],
    ["file", "filters"],
    ["timed", "volume"],
    ["timed", "filters"],
    ["seekable url", "volume"],
    ["seekable url", "filters"],
  ] as const)("keeps pause and %s %s across a paused seek without a track event", async (kind, setting) => {
    const { player, connection, events } = createPlayer();
    const passthrough = new Set((await sourcePackets(media.hour)).map(packet => packet.toString("hex")));
    if (setting === "volume") await player.setVolume(40);
    else await player.setFilters([{ name: "bassboost", value: 5 }]);
    await player.play({ itemId: "item", resource: await seekable(kind) });
    await connection.send(5);
    await player.pause();

    await player.seek(37);

    expect(player.position).toBeGreaterThanOrEqual(37);
    expect(player.position).toBeLessThan(37.1);
    expect(connection.paused).toBe(true);
    expect(connection.resume).not.toHaveBeenCalled();
    expect(connection.play).toHaveBeenCalledTimes(1);
    const after = await connection.send(30);
    expect(after).toHaveLength(30);
    expect(after.every(packet => !passthrough.has(packet.toString("hex")))).toBe(true);
    expect(events).toEqual([]);
    await player.release();
  });

  it.each(["stream", "live url"] as const)("refuses to seek a %s before native effects", async kind => {
    const { player, connection, events } = createPlayer();
    const stream = await oneShot();
    const origin = await serve(media.hour);
    const resource: PlaybackResource =
      kind === "stream" ? { kind: "stream", stream } : { kind: "url", url: origin.url };
    await player.play({ itemId: "item", resource });
    await connection.send(5);
    const requests = origin.ranges.length;

    await expect(player.seek(2)).rejects.toMatchObject({ code: "UNSUPPORTED" });

    expect(await connection.send(20)).toHaveLength(20);
    expect(origin.ranges).toHaveLength(requests);
    expect(connection.play).toHaveBeenCalledTimes(1);
    expect(stream.destroyed).toBe(false);
    expect(events).toEqual([]);
    await player.release();
  });

  it("applies a filter change to a running one-shot stream without replaying it", async () => {
    const control = createPlayer();
    const filtered = createPlayer();
    for (const { player } of [control, filtered]) {
      await player.setVolume(50);
      await player.play({ itemId: "stream", resource: { kind: "stream", stream: await oneShot() } });
    }
    await control.connection.send(20);
    await filtered.connection.send(20);

    await filtered.player.setFilters([{ name: "echo" }]);

    const plain = await control.connection.send(40);
    const echoed = await filtered.connection.send(40);
    expect(echoed).toHaveLength(40);
    expect(echoed.some((packet, index) => !packet.equals(plain[index] as Buffer))).toBe(true);
    expect(filtered.connection.play).toHaveBeenCalledTimes(1);
    expect(filtered.events).toEqual([]);
    await control.player.release();
    await filtered.player.release();
  });

  it("fences a pending seek when the track stops and joins its input", async () => {
    let seeking = false;
    const stalled = new PassThrough();
    const reader = await fileReader(media.hour, () => (seeking ? stalled : undefined));
    const { player, connection, events } = createPlayer();
    await player.play({ itemId: "reader", resource: reader.resource });
    await connection.send(5);

    seeking = true;
    const pending = player.seek(40 * 60);
    await vi.waitFor(() => expect(reader.readables).toContain(stalled));
    await player.stopTrack();

    await expect(pending).rejects.toThrow();
    await player.release();
    expect(connection.play).toHaveBeenCalledTimes(1);
    expect(reader.readables.every(readable => readable.destroyed)).toBe(true);
    expect(events).toEqual([]);
  });

  it("joins a pending URL on release without starting late playback", async () => {
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
    const { player, connection } = createPlayer();
    const playing = player.play({ itemId: "late", resource: { kind: "url", url } });
    await arrived;

    const leaving = player.release();
    respond?.(body);
    await expect(playing).rejects.toThrow();
    await leaving;
    expect(connection.play).not.toHaveBeenCalled();
  });
});
