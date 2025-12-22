import { beforeEach, describe, expect, it, vi } from "vitest";
import { DisTubeStream, Events, Queue, QueueManager, type Song } from "@";

vi.mock("src/core/DisTubeStream", () => ({
  DisTubeStream: vi.fn(() => ({ on: vi.fn() })),
}));

describe("QueueManager", () => {
  const createMockDisTube = (overrides = {}) =>
    ({
      options: {
        emitNewSongOnly: false,
        savePreviousSongs: true,
        ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
      },
      emit: vi.fn(),
      debug: vi.fn(),
      handler: { attachStreamInfo: vi.fn() },
      voices: { create: vi.fn() },
      ...overrides,
    }) as any;

  const createMockVoice = () =>
    ({
      stop: vi.fn(),
      play: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }) as any;

  describe("handleSongFinish", () => {
    describe("with _manualUpdate flag", () => {
      it("plays next song without shifting when _manualUpdate is true", async () => {
        const mockDisTube = createMockDisTube();
        const queueManager = new QueueManager(mockDisTube);
        const queue = new Queue(mockDisTube, createMockVoice());
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
    });

    describe("natural song finish", () => {
      it("shifts current song and plays next", async () => {
        const mockDisTube = createMockDisTube();
        const queueManager = new QueueManager(mockDisTube);
        const queue = new Queue(mockDisTube, createMockVoice());
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

    describe("autoplay behavior", () => {
      let mockDisTube: any;
      let queueManager: QueueManager;

      beforeEach(() => {
        mockDisTube = createMockDisTube();
        queueManager = new QueueManager(mockDisTube);
        vi.clearAllMocks();
      });

      it("adds related song when last song finishes with autoplay enabled", async () => {
        const queue = new Queue(mockDisTube, createMockVoice());
        const lastSong = { id: "last", stream: { playFromSource: true } } as Song;
        const relatedSong = { id: "related", stream: {} } as Song;

        queue.songs = [lastSong];
        queue.previousSongs = [];
        queue.autoplay = true;
        queue._manualUpdate = false;

        vi.spyOn(queue, "addRelatedSong").mockImplementation(async (song?: Song) => {
          expect(song).toBe(lastSong);
          queue.songs.push(relatedSong);
          return relatedSong;
        });
        vi.spyOn(queueManager, "playSong").mockResolvedValue(undefined);

        await queueManager.handleSongFinish(queue);

        expect(queue.addRelatedSong).toHaveBeenCalledWith(lastSong);
        expect(queue.songs).toContain(relatedSong);
        expect(queueManager.playSong).toHaveBeenCalledWith(queue, true);
      });

      it("passes finished song to addRelatedSong even when queue is empty after shift", async () => {
        const queue = new Queue(mockDisTube, createMockVoice());
        const onlySong = { id: "only", stream: { playFromSource: true } } as Song;
        const relatedSong = { id: "related", stream: {} } as Song;

        queue.songs = [onlySong];
        queue.previousSongs = [];
        queue.autoplay = true;
        queue._manualUpdate = false;

        vi.spyOn(queue, "addRelatedSong").mockImplementation(async (song?: Song) => {
          // Verify queue.songs is empty at this point but we still receive the song
          expect(queue.songs.length).toBe(0);
          expect(song).toBe(onlySong);
          queue.songs.push(relatedSong);
          return relatedSong;
        });
        vi.spyOn(queueManager, "playSong").mockResolvedValue(undefined);

        await queueManager.handleSongFinish(queue);

        expect(queue.addRelatedSong).toHaveBeenCalledWith(onlySong);
        expect(queue.songs[0]).toBe(relatedSong);
      });

      it("emits NO_RELATED event when addRelatedSong fails", async () => {
        const queue = new Queue(mockDisTube, createMockVoice());
        const onlySong = { id: "only", stream: { playFromSource: true } } as Song;

        queue.songs = [onlySong];
        queue.previousSongs = [];
        queue.autoplay = true;
        queue._manualUpdate = false;

        const noRelatedError = new Error("NO_RELATED");
        vi.spyOn(queue, "addRelatedSong").mockRejectedValue(noRelatedError);
        vi.spyOn(queue, "remove").mockImplementation(() => {});

        await queueManager.handleSongFinish(queue);

        expect(queue.addRelatedSong).toHaveBeenCalledWith(onlySong);
        expect(mockDisTube.emit).toHaveBeenCalledWith(Events.NO_RELATED, queue, noRelatedError);
        expect(queue.remove).toHaveBeenCalled();
      });

      it("removes queue when autoplay fails and no songs remain", async () => {
        const queue = new Queue(mockDisTube, createMockVoice());
        const onlySong = { id: "only", stream: { playFromSource: true } } as Song;

        queue.songs = [onlySong];
        queue.previousSongs = [];
        queue.autoplay = true;
        queue._manualUpdate = false;

        vi.spyOn(queue, "addRelatedSong").mockRejectedValue(new Error("NO_RELATED"));
        vi.spyOn(queue, "remove").mockImplementation(() => {});

        await queueManager.handleSongFinish(queue);

        expect(queue.remove).toHaveBeenCalled();
        // Should NOT emit FINISH event when autoplay is true
        expect(mockDisTube.emit).not.toHaveBeenCalledWith(Events.FINISH, queue);
      });
    });
  });

  describe("playSong", () => {
    describe("_beginTime reset", () => {
      beforeEach(() => {
        vi.clearAllMocks();
      });

      it("resets _beginTime to 0 after using it for seek", async () => {
        const mockDisTube = createMockDisTube({
          emitError: vi.fn(),
          queues: { remove: vi.fn() },
        });
        const queueManager = new QueueManager(mockDisTube);
        const mockVoice = createMockVoice();
        mockVoice.play.mockResolvedValue(undefined);
        const queue = new Queue(mockDisTube, mockVoice);
        const song = {
          id: "1",
          duration: 180,
          stream: { playFromSource: true, url: "http://test.com/stream" },
        } as Song;
        queue.songs = [song];
        queue._beginTime = 60; // Simulating a previous seek

        await queueManager.playSong(queue);

        expect(queue._beginTime).toBe(0);
        expect(DisTubeStream).toHaveBeenCalledWith(
          "http://test.com/stream",
          expect.objectContaining({
            seek: 60, // The seek value should use the original _beginTime
          }),
        );
      });

      it("preserves _beginTime value for seek option before resetting", async () => {
        const mockDisTube = createMockDisTube({
          emitError: vi.fn(),
          queues: { remove: vi.fn() },
        });
        const queueManager = new QueueManager(mockDisTube);
        const mockVoice = createMockVoice();
        mockVoice.play.mockResolvedValue(undefined);
        const queue = new Queue(mockDisTube, mockVoice);
        const song = {
          id: "1",
          duration: 300,
          stream: { playFromSource: true, url: "http://test.com/stream" },
        } as Song;
        queue.songs = [song];
        queue._beginTime = 120;

        await queueManager.playSong(queue);

        // Verify seek was called with the original _beginTime value
        expect(DisTubeStream).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            seek: 120,
          }),
        );
        // Then verify it was reset
        expect(queue._beginTime).toBe(0);
      });
    });
  });
});
