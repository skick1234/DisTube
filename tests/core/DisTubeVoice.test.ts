import { AudioPlayerStatus, VoiceConnectionStatus } from "@discordjs/voice";
import { ChannelType } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Use a mutable object to store mocks (survives hoisting)
const mocks = {
  audioPlayer: null as any,
  connection: null as any,
};

vi.mock("@discordjs/voice", async importOriginal => {
  const original = await importOriginal<typeof import("@discordjs/voice")>();

  const createMockAudioPlayer = () => ({
    on: vi.fn().mockReturnThis(),
    play: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    unpause: vi.fn(),
    state: { status: original.AudioPlayerStatus.Idle },
  });

  const createMockConnection = () => ({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn(),
    destroy: vi.fn(),
    rejoin: vi.fn().mockReturnValue(true),
    rejoinAttempts: 0,
    state: { status: original.VoiceConnectionStatus.Ready },
    joinConfig: {
      channelId: "123456789012345678",
      selfDeaf: false,
      selfMute: false,
    },
  });

  return {
    ...original,
    createAudioPlayer: vi.fn(() => {
      mocks.audioPlayer = createMockAudioPlayer();
      return mocks.audioPlayer;
    }),
    joinVoiceChannel: vi.fn(() => {
      mocks.connection = createMockConnection();
      return mocks.connection;
    }),
    entersState: vi.fn().mockImplementation(() => Promise.resolve(mocks.connection)),
  };
});

// Import after mocks are set up
import { DisTubeError, DisTubeVoice } from "@";

describe("DisTubeVoice", () => {
  const createMockVoiceManager = () =>
    ({
      client: {
        user: { id: "987654321098765432" },
        channels: {
          cache: {
            get: vi.fn().mockReturnValue({
              id: "123456789012345678",
              type: ChannelType.GuildVoice,
            }),
          },
        },
      },
      add: vi.fn(),
      remove: vi.fn(),
    }) as any;

  // Use valid snowflake IDs (17-20 digit strings)
  const createMockChannel = (overrides = {}) =>
    ({
      id: "123456789012345678", // Valid snowflake
      guildId: "234567890123456789", // Valid snowflake
      guild: {
        voiceAdapterCreator: vi.fn(),
        members: { me: { voice: {} } },
      },
      client: { user: { id: "987654321098765432" } },
      joinable: true,
      full: false,
      type: ChannelType.GuildVoice, // Proper Discord.js channel type
      ...overrides,
    }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.audioPlayer = null;
    mocks.connection = null;
  });

  describe("constructor", () => {
    it("creates voice connection and audio player", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();

      const voice = new DisTubeVoice(manager, channel);

      expect(voice.id).toBe("234567890123456789");
      expect(voice.voices).toBe(manager);
      expect(manager.add).toHaveBeenCalledWith("234567890123456789", voice);
    });

    it("sets up audio player event listeners", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();

      new DisTubeVoice(manager, channel);

      expect(mocks.audioPlayer.on).toHaveBeenCalledWith(AudioPlayerStatus.Idle, expect.any(Function));
      expect(mocks.audioPlayer.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("sets up voice connection event listeners", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();

      new DisTubeVoice(manager, channel);

      expect(mocks.connection.on).toHaveBeenCalledWith(VoiceConnectionStatus.Disconnected, expect.any(Function));
      expect(mocks.connection.on).toHaveBeenCalledWith(VoiceConnectionStatus.Destroyed, expect.any(Function));
      expect(mocks.connection.on).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  describe("channel setter", () => {
    it("throws error for different guild", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      const differentGuildChannel = createMockChannel({ guildId: "345678901234567890" });

      expect(() => {
        voice.channel = differentGuildChannel;
      }).toThrow(DisTubeError);
    });

    it("throws error for different client", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      const differentClientChannel = createMockChannel({
        client: { user: { id: "111111111111111111" } },
      });

      expect(() => {
        voice.channel = differentClientChannel;
      }).toThrow(DisTubeError);
    });

    it("throws error for non-joinable channel (full)", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      const fullChannel = createMockChannel({
        id: "456789012345678901",
        joinable: false,
        full: true,
      });

      expect(() => {
        voice.channel = fullChannel;
      }).toThrow(DisTubeError);
    });

    it("throws error for non-joinable channel (missing perms)", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      const noPermsChannel = createMockChannel({
        id: "567890123456789012",
        joinable: false,
        full: false,
      });

      expect(() => {
        voice.channel = noPermsChannel;
      }).toThrow(DisTubeError);
    });
  });

  describe("volume", () => {
    it("throws error for non-number volume", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(() => {
        voice.volume = "100" as any;
      }).toThrow(DisTubeError);
    });

    it("throws error for NaN volume", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(() => {
        voice.volume = NaN;
      }).toThrow(DisTubeError);
    });

    it("throws error for negative volume", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(() => {
        voice.volume = -1;
      }).toThrow(DisTubeError);
    });

    it("sets volume correctly", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      voice.volume = 50;
      expect(voice.volume).toBe(50);
    });
  });

  describe("stop", () => {
    it("stops audio player", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      voice.stop();

      expect(mocks.audioPlayer.stop).toHaveBeenCalledWith(false);
    });

    it("force stops audio player", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      voice.stop(true);

      expect(mocks.audioPlayer.stop).toHaveBeenCalledWith(true);
    });
  });

  describe("pause/unpause", () => {
    it("pauses audio player", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      voice.pause();

      expect(mocks.audioPlayer.pause).toHaveBeenCalled();
    });

    it("unpauses audio player when not paused", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      voice.unpause();

      // Should not call unpause when not in paused state
      expect(mocks.audioPlayer.unpause).not.toHaveBeenCalled();
    });
  });

  describe("leave", () => {
    it("emits disconnect event and destroys connection", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);
      const disconnectHandler = vi.fn();
      voice.on("disconnect", disconnectHandler);

      voice.leave();

      expect(disconnectHandler).toHaveBeenCalled();
      expect(mocks.connection.destroy).toHaveBeenCalled();
      expect(manager.remove).toHaveBeenCalledWith("234567890123456789");
    });

    it("emits disconnect with error", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);
      const disconnectHandler = vi.fn();
      voice.on("disconnect", disconnectHandler);

      const error = new Error("test error");
      voice.leave(error);

      expect(disconnectHandler).toHaveBeenCalledWith(error);
    });

    it("only emits disconnect once", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);
      const disconnectHandler = vi.fn();
      voice.on("disconnect", disconnectHandler);

      voice.leave();
      voice.leave();

      expect(disconnectHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("setSelfDeaf", () => {
    it("throws error for non-boolean", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(() => {
        voice.setSelfDeaf("true" as any);
      }).toThrow(DisTubeError);
    });

    it("rejoins with selfDeaf setting", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      const result = voice.setSelfDeaf(true);

      expect(mocks.connection.rejoin).toHaveBeenCalledWith(
        expect.objectContaining({
          selfDeaf: true,
        }),
      );
      expect(result).toBe(true);
    });
  });

  describe("setSelfMute", () => {
    it("throws error for non-boolean", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(() => {
        voice.setSelfMute("true" as any);
      }).toThrow(DisTubeError);
    });

    it("rejoins with selfMute setting", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      const result = voice.setSelfMute(true);

      expect(mocks.connection.rejoin).toHaveBeenCalledWith(
        expect.objectContaining({
          selfMute: true,
        }),
      );
      expect(result).toBe(true);
    });
  });

  describe("getters", () => {
    it("returns selfDeaf from connection config", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(voice.selfDeaf).toBe(false);
    });

    it("returns selfMute from connection config", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(voice.selfMute).toBe(false);
    });

    it("returns playbackDuration as 0 when no stream", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(voice.playbackDuration).toBe(0);
    });

    it("returns playbackTime as 0 when no stream", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(voice.playbackTime).toBe(0);
    });

    it("returns playbackTime including seekTime", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);
      voice.stream = {
        audioResource: { playbackDuration: 10000 },
        seekTime: 30,
      } as any;

      expect(voice.playbackTime).toBe(40);
    });

    it("returns channelId from connection", () => {
      const manager = createMockVoiceManager();
      const channel = createMockChannel();
      const voice = new DisTubeVoice(manager, channel);

      expect(voice.channelId).toBe("123456789012345678");
    });
  });
});
