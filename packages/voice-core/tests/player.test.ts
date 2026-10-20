import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { AudioPlayerStatus, type VoiceConnection } from "@discordjs/voice";
import type { PlaybackRequest, PlayerEvent } from "distube/integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterRegistry } from "../src/filters";
import { DiscordVoicePlayer } from "../src/player";
import { audioPlayerError, FakeConnection, latest, native, resetNative, settle } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());
vi.mock("node:child_process", async () => (await import("./support/native")).childProcessModule());

const FILE = "/tmp/distube-player-fixture.mp3";
const servers: ReturnType<typeof createServer>[] = [];

function request(itemId = "item"): PlaybackRequest {
  return { itemId, resource: { kind: "file", path: FILE } };
}

function createPlayer(): { player: DiscordVoicePlayer; connection: FakeConnection; events: PlayerEvent[] } {
  const connection = new FakeConnection();
  const player = new DiscordVoicePlayer(connection as unknown as VoiceConnection, new FilterRegistry());
  const events: PlayerEvent[] = [];
  player.subscribe(event => events.push(event));
  return { player, connection, events };
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
    await player.stopTrack();
    expect(events).toEqual([]);

    await player.play(request("second"));
    expect(latest.player.play).toHaveBeenCalledTimes(2);
    await player.release();
    await expect(player.play(request("after release"))).rejects.toThrow("retired");
  });

  it("reports a native audio error once without exposing its resource", async () => {
    const { player, events } = createPlayer();
    player.subscribe(() => {
      throw new Error("listener failed");
    });
    await player.play(request("failure"));
    const resource = latest.resource;
    const nativeError = audioPlayerError(resource, new Error("native decode failed"));

    latest.player.emit("error", nativeError);
    latest.player.emit("error", nativeError);
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "failed", itemId: "failure", error: expect.any(Error) });
    expect((events[0] as { error: Error }).error).not.toBe(nativeError);
    expect(Reflect.get((events[0] as { error: Error }).error, "resource")).toBeUndefined();
    await player.release();
  });

  it("retires on native connection destruction and suppresses later outcomes", async () => {
    const { player, connection, events } = createPlayer();
    await player.play(request("lost"));
    const child = latest.child;

    connection.transition({ status: "destroyed" });
    expect(events).toMatchObject([{ type: "failed", itemId: "lost", terminal: true }]);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await player.release();
    child.close(0, null);
    latest.player.transition({ status: AudioPlayerStatus.Idle });
    expect(events).toHaveLength(1);
  });

  it("starts a file track, applies volume and preserves item correlation", async () => {
    const { player, connection, events } = createPlayer();
    await player.setVolume(40);
    await player.play(request("A"));

    expect(connection.subscribe).toHaveBeenCalledWith(latest.player);
    expect(latest.spawn).toEqual(expect.arrayContaining(["-i", FILE, "-f", "s16le", "-ar", "48000", "-ac", "2"]));
    expect(latest.resource.volume.level).toBe(0.4);
    latest.resource.playbackDuration = 4000;
    expect(player.position).toBe(4);

    latest.child.close(0, null);
    latest.player.transition({ status: AudioPlayerStatus.Idle });
    await settle();
    expect(events).toEqual([{ type: "finished", itemId: "A" }]);
  });

  it("keeps pause, volume and filters across a file seek without a new track event", async () => {
    const { player, events } = createPlayer();
    await player.setVolume(40);
    await player.setFilters([{ name: "bassboost", value: 5 }]);
    await player.play(request());
    const first = latest.child;
    await player.pause();

    await player.seek(37);

    expect(latest.spawn).toEqual(expect.arrayContaining(["-ss", "37", "-i", FILE, "-af", "bass=g=5"]));
    expect(latest.resource.volume.level).toBe(0.4);
    expect(latest.player.state.status).toBe(AudioPlayerStatus.Paused);
    expect(player.position).toBe(37);
    first.close(1, null);
    await settle();
    expect(events).toEqual([]);
    await player.release();
  });

  it("reopens an explicitly seekable URL and keeps it out of decoder arguments", async () => {
    let requests = 0;
    const url = await origin(response => {
      requests++;
      response.writeHead(200, { "content-type": "audio/mpeg" });
      response.end(Buffer.from([1, 2, 3]));
    });
    const { player } = createPlayer();
    await player.play({ itemId: "url", resource: { kind: "url", url, seekable: true } });
    await player.seek(5);

    expect(requests).toBe(2);
    expect(latest.spawn).toEqual(expect.arrayContaining(["-i", "pipe:0", "-ss", "5"]));
    expect(latest.spawn.join(" ")).not.toContain(url);
    await player.release();
  });

  it("accepts initial filters on a one-shot stream and refuses a later restart before native effects", async () => {
    const { player } = createPlayer();
    const stream = new PassThrough();
    await player.setFilters([{ name: "echo" }]);
    await player.play({ itemId: "stream", resource: { kind: "stream", stream } });
    const spawns = native.spawns.length;
    const handoffs = latest.player.play.mock.calls.length;

    expect(latest.spawn).toEqual(expect.arrayContaining(["-af", "aecho=0.8:0.9:1000:0.3"]));
    await expect(player.seek(2)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(player.setFilters([{ name: "earwax" }])).rejects.toMatchObject({ code: "UNSUPPORTED" });
    expect(native.spawns).toHaveLength(spawns);
    expect(latest.player.play).toHaveBeenCalledTimes(handoffs);
    await player.release();
    expect(stream.destroyed).toBe(true);
  });

  it("keeps the old render if a replacement cannot produce audio", async () => {
    const { player, events } = createPlayer();
    await player.play(request());
    const first = latest.child;
    native.autoAudio = false;

    const replacing = player.seek(10);
    await settle();
    latest.child.close(1, null);

    await expect(replacing).rejects.toThrow("FFmpeg exited with code 1");
    expect(first.kill).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    await player.release();
  });

  it("fails the existing track once when native handoff fails after replacement begins", async () => {
    const { player, events } = createPlayer();
    await player.play(request());
    latest.player.play.mockImplementationOnce(() => {
      throw new Error("handoff failed");
    });

    await expect(player.seek(10)).rejects.toThrow("handoff failed");
    expect(events).toEqual([{ type: "failed", itemId: "item", error: expect.any(Error) }]);
    expect(player.position).toBe(0);
    await player.release();
  });

  it("aborts a pending URL before release and joins it without late native playback", async () => {
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
    const { player } = createPlayer();
    const playing = player.play({ itemId: "late", resource: { kind: "url", url } });
    await arrived;

    const leaving = player.release();
    respond?.(Buffer.from([1]));
    await expect(playing).rejects.toThrow();
    await leaving;
    expect(native.spawn).not.toHaveBeenCalled();
    expect(latest.player.play).not.toHaveBeenCalled();
  });

  it("aborts a pending decoder replacement when the track stops", async () => {
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
    const { player, events } = createPlayer();
    await player.play({ itemId: "url", resource: { kind: "url", url, seekable: true } });
    const seeking = player.seek(10);
    await secondRequest;
    await player.stopTrack();

    await expect(seeking).rejects.toThrow();
    expect(latest.player.play).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    await player.release();
  });
});
