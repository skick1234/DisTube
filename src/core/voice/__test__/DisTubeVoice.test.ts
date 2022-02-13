import { DisTubeError, DisTubeVoice } from "../../..";

import * as _Util from "../../../util";
import * as _DiscordVoice from "@discordjs/voice";

jest.useFakeTimers();
jest.mock("../../../util");
jest.mock("@discordjs/voice");

const Util = _Util as unknown as jest.Mocked<typeof _Util>;
const DiscordVoice = _DiscordVoice as unknown as jest.Mocked<typeof _DiscordVoice>;

const voiceManager = {
  add: jest.fn(),
  remove: jest.fn(),
};

const voiceChannel = {
  id: 1,
  guild: { id: 2, me: { voice: undefined }, voiceAdapterCreator: () => undefined },
  joinable: true,
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

const audioPlayer = {
  emit: jest.fn(),
  on: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  unpause: jest.fn(),
  play: jest.fn(),
};

const audioResource = {
  volume: {
    setVolume: jest.fn(),
  },
  playbackDuration: 1234,
};

beforeEach(() => {
  jest.resetAllMocks();
  DiscordVoice.joinVoiceChannel.mockReturnValue(connection as any);
  DiscordVoice.createAudioPlayer.mockReturnValue(audioPlayer as any);
  audioPlayer.on.mockReturnThis();
  connection.on.mockReturnThis();
});

describe("Constructor", () => {
  test("Should not create a DisTubeVoice", () => {
    Util.isSupportedVoiceChannel.mockReturnValueOnce(false);
    expect(() => {
      new DisTubeVoice(voiceManager as any, {} as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", {}, "channel"));
    Util.isSupportedVoiceChannel.mockReturnValue(true);
    expect(() => {
      new DisTubeVoice(voiceManager as any, { type: "voice", joinable: false, full: true } as any);
    }).toThrow(new DisTubeError("VOICE_FULL"));
    expect(() => {
      new DisTubeVoice(voiceManager as any, { type: "voice", joinable: false, full: false } as any);
    }).toThrow(new DisTubeError("VOICE_MISSING_PERMS"));
  });

  test("Create a new DisTubeVoice", () => {
    Util.isSupportedVoiceChannel.mockReturnValue(true);
    const voice = new DisTubeVoice(voiceManager as any, voiceChannel as any);
    voice.emit = jest.fn();
    expect(voice).toBeInstanceOf(DisTubeVoice);
    expect(voice.id).toBe(voiceChannel.guild.id);
    expect(voice.channel).toBe(voiceChannel);
    expect(DiscordVoice.joinVoiceChannel).toBeCalledWith(
      expect.objectContaining({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
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
    expect(audioPlayer.on).nthCalledWith(2, "error", expect.any(Function));
    voice.emittedError = true;
    audioPlayer.on.mock.calls[1][1](error);
    expect(voice.emit).not.toBeCalled();
    voice.emittedError = false;
    audioPlayer.on.mock.calls[1][1](error);
    expect(voice.emittedError).toBe(true);
    expect(voice.emit).toBeCalledWith("error", error);

    voice.leave = jest.fn();
    (voice.emit as jest.Mock).mockClear();
    expect(connection.on).nthCalledWith(1, DiscordVoice.VoiceConnectionStatus.Disconnected, expect.any(Function));
    const catchFn = jest.fn();
    Util.entersState.mockReturnValue({ catch: catchFn } as any);
    connection.on.mock.calls[0][1](
      {},
      { reason: DiscordVoice.VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 },
    );
    catchFn.mock.calls[0][0]();
    expect(voice.leave).toBeCalledTimes(1);

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
      const newVC: any = { guild: { id: 2 } };
      expect(() => {
        voice.channel = voiceChannel as any;
      }).toThrow(new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", voiceChannel, "DisTubeVoice#channel"));
      expect(() => {
        voice.channel = { guild: { id: 1 } } as any;
      }).toThrow(new DisTubeError("VOICE_CHANGE_GUILD"));
      expect(() => {
        voice.channel = newVC;
      }).not.toThrow();
      expect(voice.channel).toBe(newVC);
      expect(() => {
        voice.channel = voiceChannel as any;
      }).not.toThrow();
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
      voiceChannel.guild.me = { voice: {} };
      expect(voice.voiceState).toBe(voiceChannel.guild.me.voice);
      expect(voice.voiceState).not.toBeUndefined();
    });
  });

  describe("DisTubeVoice#join()", () => {
    const TIMEOUT = 30e3;

    test("Timeout when signalling connection", async () => {
      Util.entersState.mockRejectedValue(undefined);
      await expect(voice.join()).rejects.toThrow(new DisTubeError("VOICE_CONNECT_FAILED", TIMEOUT / 1e3));
      expect(Util.entersState).toBeCalledWith(connection, DiscordVoice.VoiceConnectionStatus.Ready, TIMEOUT);
      expect(connection.destroy).toBeCalledTimes(1);
      expect(voiceManager.remove).toBeCalledWith(voice.id);
    });

    test("Timeout when connection destroyed", async () => {
      const newVC = { guild: { id: 2 } };
      Util.isSupportedVoiceChannel.mockReturnValue(true);
      Util.entersState.mockRejectedValue(undefined);
      connection.state.status = DiscordVoice.VoiceConnectionStatus.Destroyed;
      await expect(voice.join(newVC as any)).rejects.toThrow(new DisTubeError("VOICE_CONNECT_FAILED", TIMEOUT / 1e3));
      expect(voice.channel).toBe(newVC);
      expect(connection.destroy).not.toBeCalled();
      expect(voiceManager.remove).toBeCalledWith(voice.id);
      connection.state.status = DiscordVoice.VoiceConnectionStatus.Signalling;
    });

    test("Joined a voice channel", async () => {
      Util.isSupportedVoiceChannel.mockReturnValue(true);
      Util.entersState.mockResolvedValue(undefined);
      await expect(voice.join(voiceChannel as any)).resolves.toBe(voice);
      expect(Util.entersState).toBeCalledWith(connection, DiscordVoice.VoiceConnectionStatus.Ready, TIMEOUT);
      expect(connection.destroy).not.toBeCalled();
      expect(voiceManager.remove).not.toBeCalled();
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
    expect(audioPlayer.play).toBeCalledWith(audioResource);
    const error = {};
    stream.stream.on.mock.calls[0][1](error);
    expect(voice.emittedError).toBe(true);
    expect(voice.emit).toBeCalledWith("error", error);
    stream.stream.on.mock.calls[0][1](error);
    expect(voice.emit).toBeCalledTimes(1);
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

  test("DisTubeVoice#unpause()", () => {
    expect(voice.unpause()).toBeUndefined();
    expect(audioPlayer.unpause).toBeCalledTimes(1);
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
