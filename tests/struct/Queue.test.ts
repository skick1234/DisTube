import { describe, expect, it, vi } from "vitest";
import { Queue, type Song } from "@";

describe("Queue Skip/Jump with requeue", () => {
  const mockDisTube = {
    options: {
      savePreviousSongs: true,
      ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
    },
    emit: vi.fn(),
    debug: vi.fn(),
    handler: { _getPluginFromSong: vi.fn().mockResolvedValue(null) },
    queues: { playSong: vi.fn() },
  } as any;

  const mockVoice = {
    id: "123",
    stop: vi.fn(),
    play: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    channel: { guild: { members: { me: {} } } },
  } as any;

  it("skip with requeue: true appends song to end", async () => {
    const queue = new Queue(mockDisTube, mockVoice);
    const song1 = { id: "1" } as Song;
    const song2 = { id: "2" } as Song;
    queue.songs = [song1, song2];

    await queue.skip({ requeue: true });

    expect(queue.songs).toEqual([song2, song1]);
    expect(queue.previousSongs).toEqual([]);
    expect(queue._manualUpdate).toBe(true);
  });

  it("jump(4) with requeue: true results in [4, 5, 1, 2, 3] and empty previousSongs", async () => {
    const queue = new Queue(mockDisTube, mockVoice);
    queue.songs = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }, { id: "5" }] as Song[];

    await queue.jump(4, { requeue: true });

    expect(queue.songs.map(s => s.id)).toEqual(["5", "1", "2", "3", "4"]);
    expect(queue.previousSongs).toEqual([]);
    expect(queue._manualUpdate).toBe(true);
  });
});
