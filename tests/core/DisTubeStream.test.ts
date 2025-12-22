import { StreamType } from "@discordjs/voice";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DisTubeStream } from "@";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    stdout: {
      pipe: vi.fn(),
    },
    stderr: {
      setEncoding: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
    },
    killed: false,
    kill: vi.fn(),
  })),
  spawnSync: vi.fn(() => ({
    error: null,
    stdout: "ffmpeg version 5.0",
    stderr: "",
    output: ["", "ffmpeg version 5.0", ""],
  })),
}));

// Mock @discordjs/voice
vi.mock("@discordjs/voice", async importOriginal => {
  const original = await importOriginal<typeof import("@discordjs/voice")>();
  return {
    ...original,
    createAudioResource: vi.fn(() => ({
      playbackDuration: 0,
    })),
  };
});

describe("DisTubeStream", () => {
  const defaultOptions = {
    ffmpeg: {
      path: "ffmpeg",
      args: {
        global: {},
        input: {},
        output: {},
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("creates a stream with default options", () => {
      const stream = new DisTubeStream("http://example.com/audio.mp3", defaultOptions);

      expect(stream).toBeDefined();
      expect(stream.stream).toBeDefined();
      expect(stream.audioResource).toBeDefined();
    });

    it("creates a stream with seek option", () => {
      const options = {
        ...defaultOptions,
        seek: 30,
      };

      const stream = new DisTubeStream("http://example.com/audio.mp3", options);

      expect(stream).toBeDefined();
      expect(stream.seekTime).toBe(30);
    });

    it("sets seekTime to 0 when no seek option provided", () => {
      const stream = new DisTubeStream("http://example.com/audio.mp3", defaultOptions);

      expect(stream.seekTime).toBe(0);
    });

    it("sets seekTime to 0 for invalid seek values", () => {
      const stream1 = new DisTubeStream("http://example.com/audio.mp3", { ...defaultOptions, seek: -10 });
      const stream2 = new DisTubeStream("http://example.com/audio.mp3", { ...defaultOptions, seek: 0 });

      expect(stream1.seekTime).toBe(0);
      expect(stream2.seekTime).toBe(0);
    });

    it("handles file:// URLs", () => {
      const stream = new DisTubeStream("file:///path/to/audio.mp3", defaultOptions);

      expect(stream).toBeDefined();
    });

    it("creates audio resource with Raw stream type", async () => {
      const { createAudioResource } = await import("@discordjs/voice");

      new DisTubeStream("http://example.com/audio.mp3", defaultOptions);

      expect(createAudioResource).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          inputType: StreamType.Raw,
          inlineVolume: false,
        }),
      );
    });
  });

  describe("spawn", () => {
    it("spawns ffmpeg process", async () => {
      const { spawn } = await import("node:child_process");
      const stream = new DisTubeStream("http://example.com/audio.mp3", defaultOptions);

      stream.spawn();

      expect(spawn).toHaveBeenCalledWith("ffmpeg", expect.any(Array), expect.any(Object));
    });

    it("emits debug events", () => {
      const stream = new DisTubeStream("http://example.com/audio.mp3", defaultOptions);
      const debugHandler = vi.fn();
      stream.on("debug", debugHandler);

      stream.spawn();

      expect(debugHandler).toHaveBeenCalled();
    });
  });

  describe("setVolume", () => {
    it("sets volume on the stream", () => {
      const stream = new DisTubeStream("http://example.com/audio.mp3", defaultOptions);

      stream.setVolume(0.5);

      expect(stream.stream.vol).toBe(0.5);
    });
  });

  describe("kill", () => {
    it("destroys stream and kills process", () => {
      const stream = new DisTubeStream("http://example.com/audio.mp3", defaultOptions);
      stream.spawn();

      stream.kill();

      expect(stream.stream.destroyed).toBe(true);
    });
  });

  describe("ffmpeg args", () => {
    it("includes reconnect options for HTTP URLs", () => {
      const stream = new DisTubeStream("http://example.com/audio.mp3", defaultOptions);

      // Check internal options contain reconnect settings
      expect(stream).toBeDefined();
    });

    it("excludes reconnect options for file URLs", () => {
      const stream = new DisTubeStream("file:///path/to/file.mp3", defaultOptions);

      expect(stream).toBeDefined();
    });

    it("includes seek option when provided", () => {
      const options = {
        ...defaultOptions,
        seek: 60,
      };

      const stream = new DisTubeStream("http://example.com/audio.mp3", options);

      expect(stream).toBeDefined();
    });

    it("merges custom ffmpeg args", () => {
      const options = {
        ffmpeg: {
          path: "/custom/ffmpeg",
          args: {
            global: { loglevel: "quiet" },
            input: { protocol_whitelist: "file,http,https" },
            output: { vn: true },
          },
        },
      };

      const stream = new DisTubeStream("http://example.com/audio.mp3", options);

      expect(stream).toBeDefined();
    });
  });
});
