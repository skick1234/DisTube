import { describe, expect, it, vi } from "vitest";
import { Queue, QueueManager, type Song } from "@";

describe("QueueManager", () => {
  const mockDisTube = {
    options: {
      emitNewSongOnly: false,
      savePreviousSongs: true,
      ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
    },
    emit: vi.fn(),
    debug: vi.fn(),
    handler: { attachStreamInfo: vi.fn() },
    voices: { create: vi.fn() },
  } as any;

  it("handleSongFinish with _manualUpdate should play next song without shifting", async () => {
    const queueManager = new QueueManager(mockDisTube);
    const mockVoice = {
      stop: vi.fn(),
      play: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as any;
    const queue = new Queue(mockDisTube, mockVoice);
    const song1 = { id: "1", stream: {} } as Song;
    const song2 = { id: "2", stream: {} } as Song;
    queue.songs = [song1, song2];
    queue._manualUpdate = true;

    vi.spyOn(queueManager, "playSong").mockResolvedValue(undefined);

    await queueManager.handleSongFinish(queue);

    expect(queue._manualUpdate).toBe(false);
    expect(queue.songs[0]).toBe(song1);
    expect(queueManager.playSong).toHaveBeenCalledWith(queue);
  });

  it("handleSongFinish natural finish should shift and play next", async () => {
    const queueManager = new QueueManager(mockDisTube);
    const mockVoice = {
      stop: vi.fn(),
      play: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as any;
    const queue = new Queue(mockDisTube, mockVoice);
    const song1 = { id: "1", stream: {} } as Song;
    const song2 = { id: "2", stream: {} } as Song;
    queue.songs = [song1, song2];
    queue._manualUpdate = false;

    vi.spyOn(queueManager, "playSong").mockResolvedValue(undefined);

    await queueManager.handleSongFinish(queue);

    expect(queue.songs[0]).toBe(song2);
    expect(queue.previousSongs[0]).toBe(song1);
    expect(queueManager.playSong).toHaveBeenCalledWith(queue, true);
  });
});
