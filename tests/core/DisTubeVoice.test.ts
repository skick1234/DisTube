import { DisTubeError, DisTubeVoice } from "@";

import * as _Util from "@/util";
import * as _DiscordVoice from "@discordjs/voice";

jest.useFakeTimers();
jest.mock("@/util");
jest.mock("@discordjs/voice");

const Util = _Util as unknown as jest.Mocked<typeof _Util>;
const DiscordVoice = _DiscordVoice as unknown as jest.Mocked<typeof _DiscordVoice>;

const client = { user: { id: 3 }, channels: { cache: { get: jest.fn() } } };

const voiceManager = {
  add: jest.fn(),
  remove: jest.fn(),
  client,
};

const voiceChannel = {
  id: 1,
  guildId: 2,
  guild: { id: 2, voiceAdapterCreator: () => undefined },
  client,
  joinable: true,
  type: 2,
};

const connection = {
  joinConfig: {
    channelId: 1,
    guildId: 2,
    selfDeaf: true,
    selfMute: false,
  },
  emit: jest.fn(),
  on: jest.fn(),
  subscribe: jest.fn(),
  rejoin: function (config: any) {
    Object.assign(this.joinConfig, config);
    this.rejoinAttempts++;
    return true;
  },
  destroy: jest.fn(),
  state: {
    status: DiscordVoice.VoiceConnectionStatus.Signalling,
  },
  rejoinAttempts: 0,
};

const audioResource = {
  volume: {
    setVolume: jest.fn(),
  },
  playbackDuration: 1234,
};

const audioPlayer = {
  emit: jest.fn(),
  on: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  unpause: jest.fn(),
  play: jest.fn(),
  state: {
    status: DiscordVoice.AudioPlayerStatus.Playing,
    resource: audioResource,
  },
};

beforeEach(() => {
  jest.resetAllMocks();
  DiscordVoice.joinVoiceChannel.mockImplementation((joinConfig: any) => {
    connection.joinConfig = joinConfig;
    return connection as any;
  });
  // DiscordVoice.joinVoiceChannel.mockReturnValue(connection as any);
  DiscordVoice.createAudioPlayer.mockReturnValue(audioPlayer as any);
  audioPlayer.on.mockReturnThis();
  connection.on.mockReturnThis();
});

describe("Constructor", () => {
  test("Should not create a DisTubeVoice", () => {
    Util.isSupportedVoiceChannel.mockReturnValueOnce(false);
    expect(() => {
      new DisTubeVoice(voiceManager as any, {} as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", {}, "DisTubeVoice#channel"));
    Util.isSupportedVoiceChannel.mockReturnValue(true);
    expect(() => {
      new DisTubeVoice(voiceManager as any, { type: "voice", joinable: false, full: true, id: "1", client } as any);
    }).toThrow(new DisTubeError("VOICE_FULL"));
    expect(() => {
      new DisTubeVoice(voiceManager as any, { type: "voice", joinable: false, full: false, id: "1", client } as any);
    }).toThrow(new DisTubeError("VOICE_MISSING_PERMS"));
  });

  test("Create a new DisTubeVoice", () => {
    Util.isSupportedVoiceChannel.mockReturnValue(true);
    const voice = new DisTubeVoice(voiceManager as any, voiceChannel as any);
    voice.emit = jest.fn();
    expect(voice).toBeInstanceOf(DisTubeVoice);
    expect(voice.id).toBe(voiceChannel.guildId);
    expect(voice.channel).toBe(voiceChannel);
    expect(DiscordVoice.joinVoiceChannel).toBeCalledWith(
      expect.objectContaining({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guildId,
        adapterCreator: expect.any(Function),
      }),
    );
    expect(voice.voices).toBe(voiceManager);
    expect(voiceManager.add).toBeCalledWith(voice.id, voice);
    expect(voice.audioPlayer).toBe(audioPlayer);
    expect(voice.connection).toBe(connection);
    expect(connection.subscribe).toBeCalledWith(audioPlayer);

    (voice.emit as jest.Mock).mockClear();
    expect(audioPlayer.on).nthCalledWith(1, DiscordVoice.AudioPlayerStatus.Idle, expect.any(Function));
    audioPlayer.on.mock.calls[0][1]({ status: DiscordVoice.AudioPlayerStatus.Idle });
    expect(voice.emit).not.toBeCalled();
    voice.audioResource = {} as any;
    audioPlayer.on.mock.calls[0][1]({ status: DiscordVoice.AudioPlayerStatus.Playing });
    expect(voice.audioResource).toBeUndefined();
    expect(voice.emit).toBeCalledWith("finish");

    (voice.emit as jest.Mock).mockClear();
    const error = {};
    expect(audioPlayer.on).nthCalledWith(3, "error", expect.any(Function));
    voice.emittedError = true;
    audioPlayer.on.mock.calls[2][1](error);
    expect(voice.emit).not.toBeCalled();
    voice.emittedError = false;
    audioPlayer.on.mock.calls[2][1](error);
    expect(voice.emittedError).toBe(true);
    expect(voice.emit).toBeCalledWith("error", error);

    voice.leave = jest.fn();
    (voice.emit as jest.Mock).mockClear();
    expect(connection.on).nthCalledWith(1, DiscordVoice.VoiceConnectionStatus.Disconnected, expect.any(Function));
    const catchFn = jest.fn();
    DiscordVoice.entersState.mockReturnValue({ catch: catchFn } as any);
    connection.on.mock.calls[0][1](
      {},
      { reason: DiscordVoice.VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 },
    );
    catchFn.mock.calls[0][0]();
    expect(voice.leave).toBeCalledTimes(1);

    connection.on.mock.calls[0][1]({}, { reason: DiscordVoice.VoiceConnectionDisconnectReason.Manual });
    expect(voice.leave).toBeCalledTimes(2);

    DiscordVoice.entersState.mockReturnValue({ catch: catchFn } as any);
    connection.on.mock.calls[0][1](
      {},
      { reason: DiscordVoice.VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 },
    );
    connection.state.status = DiscordVoice.VoiceConnectionStatus.Ready;
    catchFn.mock.calls[0][0]();
    expect(voice.leave).toBeCalledTimes(2);
    connection.state.status = DiscordVoice.VoiceConnectionStatus.Signalling;

    connection.on.mock.calls[0][1]({}, {});
    expect(connection.rejoinAttempts).toBe(0);
    jest.runAllTimers();
    expect(connection.rejoinAttempts).toBe(1);

    connection.rejoinAttempts = 5;
    (voice.emit as jest.Mock).mockClear();
    (voice.leave as jest.Mock).mockClear();
    connection.on.mock.calls[0][1]({}, {});
    expect(connection.rejoinAttempts).toBe(5);
    jest.runAllTimers();
    expect(connection.rejoinAttempts).toBe(5);
    expect(voice.leave).toBeCalledWith(new DisTubeError("VOICE_RECONNECT_FAILED"));

    (voice.emit as jest.Mock).mockClear();
    (voice.leave as jest.Mock).mockClear();
    connection.state.status = DiscordVoice.VoiceConnectionStatus.Destroyed;
    connection.on.mock.calls[0][1]({}, {});
    connection.state.status = DiscordVoice.VoiceConnectionStatus.Signalling;
    expect(connection.rejoinAttempts).toBe(5);
    jest.runAllTimers();
    expect(connection.rejoinAttempts).toBe(5);
    expect(voice.emit).not.toBeCalled();
    expect(voice.leave).not.toBeCalled();

    (voice.leave as jest.Mock).mockClear();
    expect(connection.on).nthCalledWith(2, DiscordVoice.VoiceConnectionStatus.Destroyed, expect.any(Function));
    connection.on.mock.calls[1][1]();
    expect(voice.leave).toBeCalledTimes(1);

    expect(connection.on).nthCalledWith(3, "error", expect.any(Function));
    expect(connection.on.mock.calls[2][1]()).toBeUndefined();
  });
});

describe("Methods", () => {
  Util.isSupportedVoiceChannel.mockReturnValue(true);
  DiscordVoice.joinVoiceChannel.mockReturnValue(connection as any);
  DiscordVoice.createAudioPlayer.mockReturnValue(audioPlayer as any);
  audioPlayer.on.mockReturnThis();
  connection.on.mockReturnThis();
  const voice = new DisTubeVoice(voiceManager as any, voiceChannel as any);
  voice.audioResource = {} as any;
  voice.emit = jest.fn();

  describe("Getters and setters", () => {
    test("DisTubeVoice#channel", () => {
      Util.isSupportedVoiceChannel.mockReturnValue(true);
      Util.isSupportedVoiceChannel.mockReturnValueOnce(false);
      const newVC: any = { guildId: 2, guild: { id: 2 }, client, joinable: true };
      expect(() => {
        voice.channel = newVC;
      }).toThrow(new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", newVC, "DisTubeVoice#channel"));
      expect(() => {
        voice.channel = { guildId: 1 } as any;
      }).toThrow(new DisTubeError("VOICE_DIFFERENT_GUILD"));
      expect(() => {
        voice.channel = { guildId: 2, client: { user: { id: 0 } } } as any;
      }).toThrow(new DisTubeError("VOICE_DIFFERENT_CLIENT"));
      expect(() => {
        voice.channel = newVC;
      }).not.toThrow();
      expect(voice.channel).toBe(newVC);
      expect(() => {
        voice.channel = voiceChannel as any;
      }).not.toThrow();
      client.channels.cache.get.mockReturnValue(voiceChannel);
      expect(voice.channel).toBe(voiceChannel);
      expect(voice.connection).toBe(connection);
    });

    test("DisTubeVoice#volume", () => {
      let volume: any = "0";
      expect(() => {
        voice.volume = volume;
      }).toThrow(new DisTubeError("INVALID_TYPE", "number", volume, "volume"));
      volume = NaN;
      expect(() => {
        voice.volume = volume;
      }).toThrow(new DisTubeError("INVALID_TYPE", "number", volume, "volume"));
      volume = -1;
      expect(() => {
        voice.volume = volume;
      }).toThrow(new DisTubeError("NUMBER_COMPARE", "Volume", "bigger or equal to", 0));
      voice.audioResource = audioResource as any;
      volume = 100;
      expect(() => {
        voice.volume = volume;
      }).not.toThrow();
      expect(voice.volume).toBe(volume);
      expect(audioResource.volume.setVolume).toBeCalledTimes(1);
      expect(audioResource.volume.setVolume).toHaveBeenNthCalledWith(1, 1);
      volume = 50;
      expect(() => {
        voice.volume = volume;
      }).not.toThrow();
      expect(audioResource.volume.setVolume).toBeCalledTimes(2);
      expect(audioResource.volume.setVolume).toHaveBeenNthCalledWith(2, 0.31622776601683794);
    });

    test("Other getters", () => {
      voice.audioResource = undefined;
      expect(voice.playbackDuration).toBe(0);
      voice.audioResource = { playbackDuration: 100 } as any;
      expect(voice.playbackDuration).toBe(0.1);
      expect(voice.selfDeaf).toBe(connection.joinConfig.selfDeaf);
      expect(voice.selfMute).toBe(connection.joinConfig.selfMute);
      expect(voice.voiceState).toBeUndefined();
    });
  });

  describe("DisTubeVoice#join()", () => {
    const TIMEOUT = 30e3;

    test("Signalling connection timeout", async () => {
      DiscordVoice.entersState.mockRejectedValue(undefined);
      await expect(voice.join()).rejects.toThrow(new DisTubeError("VOICE_CONNECT_FAILED", TIMEOUT / 1e3));
      expect(DiscordVoice.entersState).toBeCalledWith(connection, DiscordVoice.VoiceConnectionStatus.Ready, TIMEOUT);
      expect(connection.destroy).toBeCalledTimes(1);
      expect(voiceManager.remove).toBeCalledWith(voice.id);
    });

    test("Connection destroyed", async () => {
      const newVC = { guildId: 2, guild: { id: 2 }, client, joinable: true };
      Util.isSupportedVoiceChannel.mockReturnValue(true);
      DiscordVoice.entersState.mockRejectedValue(undefined);
      connection.state.status = DiscordVoice.VoiceConnectionStatus.Destroyed;
      await expect(voice.join(newVC as any)).rejects.toThrow(new DisTubeError("VOICE_CONNECT_FAILED", TIMEOUT / 1e3));
      expect(voice.channel).toBe(newVC);
      expect(connection.destroy).not.toBeCalled();
      expect(voiceManager.remove).toBeCalledWith(voice.id);
      connection.state.status = DiscordVoice.VoiceConnectionStatus.Signalling;
    });

    test("Joined a voice channel after timeout", async () => {
      Util.isSupportedVoiceChannel.mockReturnValue(true);
      DiscordVoice.entersState.mockImplementationOnce(<any>(() => {
        connection.state.status = DiscordVoice.VoiceConnectionStatus.Ready;
        throw new Error();
      }));
      await expect(voice.join(voiceChannel as any)).resolves.toBe(voice);
      expect(DiscordVoice.entersState).toBeCalledWith(connection, DiscordVoice.VoiceConnectionStatus.Ready, TIMEOUT);
      expect(connection.destroy).not.toBeCalled();
      expect(voiceManager.remove).not.toBeCalled();
      client.channels.cache.get.mockReturnValue({ type: 0 });
      expect(voice.channel).toBe(voiceChannel);
      expect(voice.connection).toBe(connection);
      connection.state.status = DiscordVoice.VoiceConnectionStatus.Signalling;
    });

    test("Joined a voice channel", async () => {
      Util.isSupportedVoiceChannel.mockReturnValue(true);
      DiscordVoice.entersState.mockResolvedValue(undefined);
      await expect(voice.join(voiceChannel as any)).resolves.toBe(voice);
      expect(DiscordVoice.entersState).toBeCalledWith(connection, DiscordVoice.VoiceConnectionStatus.Ready, TIMEOUT);
      expect(connection.destroy).not.toBeCalled();
      expect(voiceManager.remove).not.toBeCalled();
      client.channels.cache.get.mockReturnValue({ type: 0 });
      expect(voice.channel).toBe(voiceChannel);
      expect(voice.connection).toBe(connection);
    });
  });

  describe("DisTubeVoice#leave()", () => {
    describe("Destroy the connection", () => {
      test("Without error", () => {
        connection.state.status = DiscordVoice.VoiceConnectionStatus.Ready;
        expect(voice.leave()).toBeUndefined();
        expect(audioPlayer.stop).toBeCalledTimes(1);
        expect(audioPlayer.stop).toBeCalledWith(true);
        expect(connection.destroy).toBeCalledTimes(1);
        expect(voice.emit).toBeCalledWith("disconnect", undefined);
        expect(voiceManager.remove).toBeCalledWith(voice.id);
      });
    });

    test("Leave the destroyed connection", () => {
      connection.state.status = DiscordVoice.VoiceConnectionStatus.Destroyed;
      expect(voice.leave()).toBeUndefined();
      expect(audioPlayer.stop).toBeCalledTimes(1);
      expect(audioPlayer.stop).toBeCalledWith(true);
      expect(voice.emit).not.toBeCalled();
      expect(connection.destroy).not.toBeCalled();
      expect(voiceManager.remove).toBeCalledWith(voice.id);
      connection.state.status = DiscordVoice.VoiceConnectionStatus.Signalling;
    });
  });

  test("DisTubeVoice#play()", () => {
    delete voice.audioResource;
    voice.emittedError = true;
    DiscordVoice.createAudioResource.mockReturnValue(audioResource as any);
    const stream = {
      stream: {
        on: jest.fn(),
      },
      type: {},
    };
    expect(voice.play(stream as any)).toBeUndefined();
    expect(voice.emittedError).toBe(false);
    expect(stream.stream.on).toBeCalledWith("error", expect.any(Function));
    expect(voice.audioResource).toBe(audioResource);
    expect(audioPlayer.play).toBeCalledTimes(1);
    expect(audioPlayer.play).nthCalledWith(1, audioResource);
    const error = {};
    stream.stream.on.mock.calls[0][1](error);
    expect(voice.emittedError).toBe(true);
    expect(voice.emit).toBeCalledWith("error", error);
    stream.stream.on.mock.calls[0][1](error);
    expect(voice.emit).toBeCalledTimes(1);

    audioPlayer.state.status = DiscordVoice.AudioPlayerStatus.Paused;
    expect(voice.play(stream as any)).toBeUndefined();
    expect(audioPlayer.play).toBeCalledTimes(1);
    audioPlayer.state.status = DiscordVoice.AudioPlayerStatus.Playing;
  });

  test("DisTubeVoice#stop()", () => {
    expect(voice.stop()).toBeUndefined();
    expect(audioPlayer.stop).toBeCalledTimes(1);
    expect(audioPlayer.stop).toBeCalledWith(false);
    expect(voice.stop(true)).toBeUndefined();
    expect(audioPlayer.stop).toBeCalledTimes(2);
    expect(audioPlayer.stop).lastCalledWith(true);
  });

  test("DisTubeVoice#pause()", () => {
    expect(voice.pause()).toBeUndefined();
    expect(audioPlayer.pause).toBeCalledTimes(1);
  });

  describe("DisTubeVoice#unpause()", () => {
    test("Unpause when playing", () => {
      expect(voice.unpause()).toBeUndefined();
      expect(audioPlayer.unpause).toBeCalledTimes(0);
    });
    test("Unpause when paused with same resource", () => {
      audioPlayer.state.status = DiscordVoice.AudioPlayerStatus.Paused;
      expect(voice.unpause()).toBeUndefined();
      expect(audioPlayer.unpause).toBeCalledTimes(1);
      audioPlayer.state.status = DiscordVoice.AudioPlayerStatus.Playing;
    });
    test("Unpause when paused with different resource", () => {
      audioPlayer.state.status = DiscordVoice.AudioPlayerStatus.Paused;
      voice.audioResource = {} as any;
      expect(voice.unpause()).toBeUndefined();
      expect(audioPlayer.unpause).toBeCalledTimes(0);
      expect(audioPlayer.play).toBeCalledTimes(1);
      expect(audioPlayer.play).toBeCalledWith(voice.audioResource);
      audioPlayer.state.status = DiscordVoice.AudioPlayerStatus.Playing;
    });
  });

  test("DisTubeVoice#setSelfDeaf()", () => {
    expect(() => {
      voice.setSelfDeaf("a string" as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "boolean", "a string", "selfDeaf"));
    let selfDeaf = true;
    expect(voice.setSelfDeaf(selfDeaf)).toBe(true);
    expect(connection.joinConfig).toStrictEqual(expect.objectContaining({ selfDeaf }));
    selfDeaf = false;
    expect(voice.setSelfDeaf(selfDeaf)).toBe(true);
    expect(connection.joinConfig).toStrictEqual(expect.objectContaining({ selfDeaf }));
  });

  test("DisTubeVoice#setSelfMute()", () => {
    expect(() => {
      voice.setSelfMute("a string" as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "boolean", "a string", "selfMute"));
    let selfMute = true;
    expect(voice.setSelfMute(selfMute)).toBe(true);
    expect(connection.joinConfig).toStrictEqual(expect.objectContaining({ selfMute }));
    selfMute = false;
    expect(voice.setSelfMute(selfMute)).toBe(true);
    expect(connection.joinConfig).toStrictEqual(expect.objectContaining({ selfMute }));
  });
});
