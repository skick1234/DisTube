import { beforeEach, describe, expect, it, vi } from "vitest";
import { DisTubeError, Queue, RepeatMode, type Song } from "@";

describe("Queue", () => {
  const createMockVoice = () =>
    ({
      id: "123456789012345678",
      stop: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      unpause: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      volume: 50,
      playbackDuration: 0,
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

  describe("seek", () => {
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

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("seek sets _beginTime to the specified time and calls play(false)", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.songs = [{ id: "1" } as Song];

      queue.seek(30);

      expect(queue._beginTime).toBe(30);
      expect(mockDisTube.queues.playSong).toHaveBeenCalledWith(queue, false);
    });

    it("play() delegates to queues.playSong with emitPlaySong parameter", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.songs = [{ id: "1" } as Song];

      queue.play(true);
      expect(mockDisTube.queues.playSong).toHaveBeenCalledWith(queue, true);

      vi.clearAllMocks();

      queue.play(false);
      expect(mockDisTube.queues.playSong).toHaveBeenCalledWith(queue, false);
    });
  });

  describe("addToQueue", () => {
    const mockDisTube = {
      options: {
        savePreviousSongs: true,
        ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
      },
      emit: vi.fn(),
      debug: vi.fn(),
      handler: {},
      queues: { playSong: vi.fn(), remove: vi.fn() },
    } as any;

    it("adds a single song to the end of the queue", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      const song1 = { id: "1" } as Song;
      const song2 = { id: "2" } as Song;
      queue.songs = [song1];

      queue.addToQueue(song2);

      expect(queue.songs).toEqual([song1, song2]);
    });

    it("adds a song at a specific position", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      const song1 = { id: "1" } as Song;
      const song2 = { id: "2" } as Song;
      const song3 = { id: "3" } as Song;
      queue.songs = [song1, song3];

      queue.addToQueue(song2, 1);

      expect(queue.songs).toEqual([song1, song2, song3]);
    });

    it("adds an array of songs", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      const song1 = { id: "1" } as Song;
      const song2 = { id: "2" } as Song;
      const song3 = { id: "3" } as Song;
      queue.songs = [song1];

      queue.addToQueue([song2, song3]);

      expect(queue.songs).toEqual([song1, song2, song3]);
    });

    it("throws error when queue is stopped", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.stopped = true;

      expect(() => queue.addToQueue({ id: "1" } as Song)).toThrow(DisTubeError);
    });

    it("throws error for invalid song", () => {
      const queue = new Queue(mockDisTube, createMockVoice());

      expect(() => queue.addToQueue(null as any)).toThrow(DisTubeError);
      expect(() => queue.addToQueue([] as any)).toThrow(DisTubeError);
    });
  });

  describe("setRepeatMode", () => {
    const mockDisTube = {
      options: {
        savePreviousSongs: true,
        ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
      },
      emit: vi.fn(),
      debug: vi.fn(),
      handler: {},
      queues: { playSong: vi.fn() },
    } as any;

    it("toggles repeat mode when no argument provided", () => {
      const queue = new Queue(mockDisTube, createMockVoice());

      expect(queue.repeatMode).toBe(RepeatMode.DISABLED);

      queue.setRepeatMode();
      expect(queue.repeatMode).toBe(RepeatMode.SONG);

      queue.setRepeatMode();
      expect(queue.repeatMode).toBe(RepeatMode.QUEUE);

      queue.setRepeatMode();
      expect(queue.repeatMode).toBe(RepeatMode.DISABLED);
    });

    it("sets specific repeat mode", () => {
      const queue = new Queue(mockDisTube, createMockVoice());

      queue.setRepeatMode(RepeatMode.QUEUE);
      expect(queue.repeatMode).toBe(RepeatMode.QUEUE);
    });

    it("disables repeat mode when same mode is set", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.repeatMode = RepeatMode.SONG;

      queue.setRepeatMode(RepeatMode.SONG);
      expect(queue.repeatMode).toBe(RepeatMode.DISABLED);
    });

    it("throws error for invalid mode", () => {
      const queue = new Queue(mockDisTube, createMockVoice());

      expect(() => queue.setRepeatMode(999 as any)).toThrow(DisTubeError);
    });
  });

  describe("toggleAutoplay", () => {
    const mockDisTube = {
      options: {
        savePreviousSongs: true,
        ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
      },
      emit: vi.fn(),
      debug: vi.fn(),
      handler: {},
      queues: { playSong: vi.fn() },
    } as any;

    it("toggles autoplay state", () => {
      const queue = new Queue(mockDisTube, createMockVoice());

      expect(queue.autoplay).toBe(false);

      const result1 = queue.toggleAutoplay();
      expect(result1).toBe(true);
      expect(queue.autoplay).toBe(true);

      const result2 = queue.toggleAutoplay();
      expect(result2).toBe(false);
      expect(queue.autoplay).toBe(false);
    });
  });

  describe("setVolume", () => {
    const mockDisTube = {
      options: {
        savePreviousSongs: true,
        ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
      },
      emit: vi.fn(),
      debug: vi.fn(),
      handler: {},
      queues: { playSong: vi.fn() },
    } as any;

    it("sets volume and returns queue", () => {
      const queue = new Queue(mockDisTube, createMockVoice());

      const result = queue.setVolume(75);

      expect(queue.volume).toBe(75);
      expect(result).toBe(queue);
    });
  });

  describe("getters", () => {
    const mockDisTube = {
      options: {
        savePreviousSongs: true,
        ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
      },
      emit: vi.fn(),
      debug: vi.fn(),
      handler: {},
      queues: { playSong: vi.fn() },
    } as any;

    it("returns correct duration", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.songs = [
        { id: "1", duration: 100 },
        { id: "2", duration: 200 },
      ] as Song[];

      expect(queue.duration).toBe(300);
    });

    it("returns 0 duration for empty queue", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.songs = [];

      expect(queue.duration).toBe(0);
    });

    it("returns formatted duration", () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.songs = [{ id: "1", duration: 65 }] as Song[];

      expect(queue.formattedDuration).toBe("01:05");
    });

    it("returns current time", () => {
      const mockVoice = { ...createMockVoice(), playbackDuration: 10 };
      const queue = new Queue(mockDisTube, mockVoice as any);
      queue._beginTime = 30;

      expect(queue.currentTime).toBe(40);
    });

    it("returns playing state", () => {
      const queue = new Queue(mockDisTube, createMockVoice());

      expect(queue.isPlaying()).toBe(false);

      queue.playing = true;
      expect(queue.isPlaying()).toBe(true);
    });

    it("returns paused state", () => {
      const queue = new Queue(mockDisTube, createMockVoice());

      expect(queue.isPaused()).toBe(false);

      queue.paused = true;
      expect(queue.isPaused()).toBe(true);
    });
  });

  describe("pause/resume", () => {
    const mockDisTube = {
      options: {
        savePreviousSongs: true,
        ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
      },
      emit: vi.fn(),
      debug: vi.fn(),
      handler: {},
      queues: { playSong: vi.fn() },
    } as any;

    it("pause sets paused state and calls voice.pause", async () => {
      const mockVoice = createMockVoice();
      const queue = new Queue(mockDisTube, mockVoice);
      queue.paused = false;

      const result = await queue.pause();

      expect(queue.paused).toBe(true);
      expect(mockVoice.pause).toHaveBeenCalled();
      expect(result).toBe(queue);
    });

    it("pause throws error when already paused", async () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.paused = true;

      await expect(queue.pause()).rejects.toThrow(DisTubeError);
    });

    it("resume sets playing state and calls voice.unpause", async () => {
      const mockVoice = createMockVoice();
      const queue = new Queue(mockDisTube, mockVoice);
      queue.paused = true;

      const result = await queue.resume();

      expect(queue.paused).toBe(false);
      expect(mockVoice.unpause).toHaveBeenCalled();
      expect(result).toBe(queue);
    });

    it("resume throws error when not paused", async () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.paused = false;

      await expect(queue.resume()).rejects.toThrow(DisTubeError);
    });
  });

  describe("shuffle", () => {
    const mockDisTube = {
      options: {
        savePreviousSongs: true,
        ffmpeg: { path: "ffmpeg", args: { global: {}, input: {}, output: {} } },
      },
      emit: vi.fn(),
      debug: vi.fn(),
      handler: {},
      queues: { playSong: vi.fn() },
    } as any;

    it("shuffles songs while keeping current song first", async () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      const song1 = { id: "1" } as Song;
      const song2 = { id: "2" } as Song;
      const song3 = { id: "3" } as Song;
      const song4 = { id: "4" } as Song;
      queue.songs = [song1, song2, song3, song4];

      const result = await queue.shuffle();

      // First song should remain the same
      expect(queue.songs[0]).toBe(song1);
      expect(result).toBe(queue);
    });

    it("returns queue unchanged when empty", async () => {
      const queue = new Queue(mockDisTube, createMockVoice());
      queue.songs = [];

      const result = await queue.shuffle();

      expect(queue.songs).toEqual([]);
      expect(result).toBe(queue);
    });
  });
});
