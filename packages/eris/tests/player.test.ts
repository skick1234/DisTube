import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { FilterRegistry } from "@distube/voice-core/core";
import type { PlaybackRequest, PlayerEvent } from "distube/integrations";
import type { VoiceConnection } from "eris";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErisVoicePlayer } from "../src/player";
import { FakeVoiceConnection, latest, native, resetNative, settle } from "./support/eris";

vi.mock("node:child_process", async () => (await import("./support/eris")).childProcessModule());

const FILE = "/tmp/distube-eris-fixture.mp3";
const servers: ReturnType<typeof createServer>[] = [];

function request(itemId = "item"): PlaybackRequest {
  return { itemId, resource: { kind: "file", path: FILE } };
}

function createPlayer(): { player: ErisVoicePlayer; connection: FakeVoiceConnection; events: PlayerEvent[] } {
  const connection = new FakeVoiceConnection();
  const player = new ErisVoicePlayer(connection as unknown as VoiceConnection, new FilterRegistry());
  const events: PlayerEvent[] = [];
  player.subscribe(event => events.push(event));
  return { player, connection, events };
}

async function release(player: ErisVoicePlayer): Promise<void> {
  const leaving = player.release();
  for (const child of native.children) if (child.exitCode === null) child.close(null, "SIGKILL");
  await leaving;
}

async function origin(respond: (response: ServerResponse, count: number) => void): Promise<string> {
  let count = 0;
  const server = createServer((_request, response) => respond(response, ++count));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/audio`;
}

beforeEach(resetNative);
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe("Eris local Player", () => {
  it("rejects invalid controls and remains reusable after stopping a track", async () => {
    const { player, connection, events } = createPlayer();
    await expect(player.pause()).rejects.toThrow("no active playback");
    await expect(player.resume()).rejects.toThrow("no active playback");
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
    for (const child of native.children) child.close(null, "SIGKILL");
    await firstRelease;
    await expect(player.play(request("after release"))).rejects.toThrow("retired");
  });

  it("starts a file track and correlates the exact native completion", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A"));

    expect(connection.play).toHaveBeenCalledWith(latest.child.stdout, {
      format: "pcm",
      inlineVolume: true,
      voiceDataTimeout: 15_000,
    });
    expect(latest.spawn).toEqual(expect.arrayContaining(["-i", FILE, "-f", "s16le", "-ar", "48000", "-ac", "2"]));
    expect(connection.resume).toHaveBeenCalledTimes(1);
    if (connection.current) connection.current.playTime = 4000;
    expect(player.position).toBe(4);

    latest.child.close(0, null);
    connection.finishCurrent();
    await settle();
    expect(events).toEqual([{ type: "finished", itemId: "A" }]);
  });

  it("does not finish a track when Eris stops it while the connection is tearing down", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("A"));

    latest.child.close(0, null);
    connection.ready = false;
    connection.finishCurrent();
    await settle();
    expect(events).toEqual([]);
    await release(player);
  });

  it("keeps pause, volume and filters across a file seek", async () => {
    const { player, connection, events } = createPlayer();
    await player.setVolume(40);
    await player.setFilters([{ name: "bassboost", value: 5 }]);
    await player.play(request());
    const first = latest.child;
    await player.pause();

    await player.seek(37);

    expect(latest.spawn).toEqual(expect.arrayContaining(["-ss", "37", "-i", FILE, "-af", "bass=g=5"]));
    expect(connection.setVolume).toHaveBeenLastCalledWith(0.4);
    expect(connection.paused).toBe(true);
    expect(player.position).toBe(37);
    first.close(1, null);
    await settle();
    expect(events).toEqual([]);
    await release(player);
  });

  it("reopens a seekable URL while keeping its address out of FFmpeg arguments", async () => {
    let requests = 0;
    const url = await origin(response => {
      requests++;
      response.writeHead(200);
      response.end(Buffer.from([1, 2, 3]));
    });
    const { player } = createPlayer();
    await player.play({ itemId: "url", resource: { kind: "url", url, seekable: true } });
    await player.seek(5);

    expect(requests).toBe(2);
    expect(latest.spawn).toEqual(expect.arrayContaining(["-i", "pipe:0", "-ss", "5"]));
    expect(latest.spawn.join(" ")).not.toContain(url);
    await release(player);
  });

  it("applies initial filters to a one-shot stream and refuses restart controls", async () => {
    const { player, connection } = createPlayer();
    const stream = new PassThrough();
    await player.setFilters([{ name: "echo" }]);
    await player.play({ itemId: "stream", resource: { kind: "stream", stream } });
    const handoffs = connection.play.mock.calls.length;
    const spawns = native.spawns.length;

    expect(latest.spawn).toEqual(expect.arrayContaining(["-af", "aecho=0.8:0.9:1000:0.3"]));
    await expect(player.seek(2)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(player.setFilters([{ name: "earwax" }])).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(connection.play).toHaveBeenCalledTimes(handoffs);
    expect(native.spawns).toHaveLength(spawns);
    await release(player);
    expect(stream.destroyed).toBe(true);
  });

  it("keeps the old render when candidate PCM never arrives", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    const first = latest.child;
    native.autoAudio = false;

    const seeking = player.seek(10);
    await settle();
    latest.child.close(1, null);

    await expect(seeking).rejects.toThrow("FFmpeg exited with code 1");
    expect(first.kill).not.toHaveBeenCalled();
    expect(connection.play).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    await release(player);
  });

  it("fails the existing track once after an irreversible native handoff failure", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request());
    connection.play.mockImplementationOnce(() => {
      throw new Error("handoff failed");
    });

    await expect(player.seek(10)).rejects.toThrow("handoff failed");
    expect(events).toEqual([{ type: "failed", itemId: "item", error: expect.any(Error) }]);
    expect(player.position).toBe(0);
    await release(player);
  });

  it("joins a pending URL on release without starting late playback", async () => {
    let respond: ((body: Buffer) => void) | undefined;
    let requested!: () => void;
    const arrived = new Promise<void>(resolve => {
      requested = resolve;
    });
    const url = await origin(response => {
      respond = body => {
        response.writeHead(200);
        response.end(body);
      };
      requested();
    });
    const { player, connection } = createPlayer();
    const playing = player.play({ itemId: "late", resource: { kind: "url", url } });
    await arrived;

    const leaving = player.release();
    respond?.(Buffer.from([1]));
    await expect(playing).rejects.toThrow();
    await leaving;
    expect(native.spawn).not.toHaveBeenCalled();
    expect(connection.play).not.toHaveBeenCalled();
  });

  it("stops during a URL decoder replacement and suppresses late handoff", async () => {
    let count = 0;
    let requested!: () => void;
    const secondRequest = new Promise<void>(resolve => {
      requested = resolve;
    });
    const url = await origin(response => {
      if (++count === 2) {
        requested();
        return;
      }
      response.writeHead(200);
      response.end(Buffer.from([1]));
    });
    const { player, connection, events } = createPlayer();
    await player.play({ itemId: "url", resource: { kind: "url", url, seekable: true } });
    const seeking = player.seek(10);
    await secondRequest;
    await player.stopTrack();

    await expect(seeking).rejects.toThrow();
    expect(connection.play).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    await release(player);
  });
});
