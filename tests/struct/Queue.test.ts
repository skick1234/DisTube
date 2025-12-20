import { beforeEach, describe, expect, it, vi } from "vitest";
import { DisTubeError, Queue, type Song } from "@";

describe("Queue", () => {
  const createMockVoice = () =>
    ({
      id: "123",
      stop: vi.fn(),
      play: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      channel: { guild: { members: { me: {} } } },
    }) as any;

  describe("addRelatedSong", () => {
    const mockPlugin = {
      getRelatedSongs: vi.fn(),
    };

    const mockDisTube = {
      options: {
        savePreviousSongs: true,
        ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
      },
      emit: vi.fn(),
      debug: vi.fn(),
      handler: { _getPluginFromSong: vi.fn().mockResolvedValue(mockPlugin) },
      queues: { playSong: vi.fn() },
    } as any;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("uses provided song parameter instead of songs[0]", async () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      const providedSong = { id: "provided", stream: { playFromSource: true } } as Song;
      const relatedSong = { id: "related", stream: {} } as Song;

      // Queue is empty - no songs[0]
      queue.songs = [];
      queue.previousSongs = [];

      mockPlugin.getRelatedSongs.mockResolvedValue([relatedSong]);

      const result = await queue.addRelatedSong(providedSong);

      expect(result).toBe(relatedSong);
      expect(queue.songs).toContain(relatedSong);
      expect(mockDisTube.handler._getPluginFromSong).toHaveBeenCalledWith(providedSong);
    });

    it("falls back to songs[0] when no parameter provided", async () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      const currentSong = { id: "current", stream: { playFromSource: true } } as Song;
      const relatedSong = { id: "related", stream: {} } as Song;

      queue.songs = [currentSong];
      queue.previousSongs = [];

      mockPlugin.getRelatedSongs.mockResolvedValue([relatedSong]);

      const result = await queue.addRelatedSong();

      expect(result).toBe(relatedSong);
      expect(mockDisTube.handler._getPluginFromSong).toHaveBeenCalledWith(currentSong);
    });

    it("throws NO_PLAYING_SONG when no song provided and queue is empty", async () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.songs = [];

      await expect(queue.addRelatedSong()).rejects.toThrow(DisTubeError);
      await expect(queue.addRelatedSong()).rejects.toThrow("no playing song");
    });
  });

  describe("skip/jump with requeue option", () => {
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

    it("skip with requeue: true appends song to end", async () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      const song1 = { id: "1" } as Song;
      const song2 = { id: "2" } as Song;
      queue.songs = [song1, song2];

      await queue.skip({ requeue: true });

      expect(queue.songs).toEqual([song2, song1]);
      expect(queue.previousSongs).toEqual([]);
      expect(queue._manualUpdate).toBe(true);
    });

    it("jump(4) with requeue: true results in [5, 1, 2, 3, 4] and empty previousSongs", async () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.songs = [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }, { id: "5" }] as Song[];

      await queue.jump(4, { requeue: true });

      expect(queue.songs.map(s => s.id)).toEqual(["5", "1", "2", "3", "4"]);
      expect(queue.previousSongs).toEqual([]);
      expect(queue._manualUpdate).toBe(true);
    });
  });
});
