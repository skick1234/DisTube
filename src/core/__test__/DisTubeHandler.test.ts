import { DisTubeError, DisTubeHandler, Playlist, SearchResult, Song, defaultFilters, defaultOptions } from "../..";
import { firstPlaylistInfo, playlistResults, videoResults } from "./raw";

import * as _ytpl from "@distube/ytpl";
import * as _ytdl from "ytdl-core";
import * as _Util from "../../util";
import * as _Queue from "../../struct/Queue";
import * as _Stream from "../DisTubeStream";

jest.mock("@distube/ytpl");
jest.mock("ytdl-core");
jest.mock("../../util");
jest.mock("../../struct/Queue");
jest.mock("../DisTubeStream");

const ytpl = _ytpl as unknown as jest.Mocked<typeof _ytpl>;
const ytdl = _ytdl as unknown as jest.Mocked<typeof _ytdl>;
const Util = _Util as unknown as jest.Mocked<typeof _Util>;
const Queue = _Queue as unknown as jest.Mocked<typeof _Queue>;
const Stream = _Stream as unknown as jest.Mocked<typeof _Stream>;

function createFakeQueueManager() {
  return {
    create: jest.fn(),
    get: jest.fn(),
  };
}

const extractor = {
  validate: jest.fn(),
  resolve: jest.fn(),
};

function createFakeDisTube() {
  return {
    options: { ...defaultOptions },
    filters: defaultFilters,
    queues: createFakeQueueManager(),
    emit: jest.fn(),
    extractorPlugins: [extractor],
    search: jest.fn(),
  };
}

const member: any = {};
const songResult = new SearchResult(videoResults.items[0] as any);
const plResult = new SearchResult(playlistResults.items[0] as any);
const song = new Song({ id: "xxxxxxxxxxx", url: "https://www.youtube.com/watch?v=xxxxxxxxxxx" }, member);
const anotherSong = new Song({ id: "y", url: "https://www.youtube.com/watch?v=y" }, member, "test");
const nsfwSong = new Song({ id: "z", url: "z url", age_restricted: true }, member, "test");
const playlist = new Playlist([song, anotherSong, nsfwSong], member);

afterEach(() => {
  jest.resetAllMocks();
});

describe("Constructor", () => {
  test("youtubeCookie is undefined", () => {
    const distube = createFakeDisTube();
    const handler = new DisTubeHandler(distube as any);
    expect(handler.ytdlOptions).toBe(distube.options.ytdlOptions);
    expect(handler.ytdlOptions.requestOptions).not.toBeDefined();
  });

  describe("youtubeCookie is a string", () => {
    const distube = createFakeDisTube();
    const cookie = "a valid cookie";
    distube.options.youtubeCookie = cookie;

    test("youtubeIdentityToken is undefined", () => {
      const handler = new DisTubeHandler(distube as any);
      expect(handler.ytdlOptions).toBe(distube.options.ytdlOptions);
      expect((handler.ytdlOptions.requestOptions as any).headers.cookie).toBe(cookie);
      expect((handler.ytdlOptions.requestOptions as any).headers["x-youtube-identity-token"]).not.toBeDefined();
    });

    test("youtubeIdentityToken is a string", () => {
      const idToken = "a valid token";
      distube.options.youtubeIdentityToken = idToken;
      const handler = new DisTubeHandler(distube as any);
      expect(handler.ytdlOptions).toBe(distube.options.ytdlOptions);
      expect((handler.ytdlOptions.requestOptions as any).headers.cookie).toBe(cookie);
      expect((handler.ytdlOptions.requestOptions as any).headers["x-youtube-identity-token"]).toBe(idToken);
    });
  });
});

describe("DisTubeHandler#createQueue()", () => {
  const distube = createFakeDisTube();
  const handler = new DisTubeHandler(distube as any);

  test("User is not in a voice channel", async () => {
    Util.isMessageInstance.mockReturnValue(true);
    const message: any = { member: { voice: { channel: null } } };
    await expect(handler.createQueue(message, song)).rejects.toThrow(new DisTubeError("NOT_IN_VOICE"));
    expect(Util.isMessageInstance).toBeCalledWith(message);
  });

  test("User is in an unsupported voice channel", async () => {
    Util.isMessageInstance.mockReturnValue(false);
    Util.isSupportedVoiceChannel.mockReturnValue(false);
    const message: any = { member: { voice: { channel: { type: "unsupported" } } } };
    await expect(handler.createQueue(message, song)).rejects.toThrow(new DisTubeError("NOT_SUPPORTED_VOICE"));
    expect(Util.isMessageInstance).toBeCalledWith(message.member.voice.channel);
  });

  test("User is in a supported voice channel", async () => {
    Util.isMessageInstance.mockReturnValue(false);
    Util.isSupportedVoiceChannel.mockReturnValue(true);
    distube.queues.create.mockReturnValue(true);
    const message: any = {
      member: { voice: { channel: { type: "voice" } } },
      channel: { id: "a text channel" },
    };
    await expect(handler.createQueue(message, song)).resolves.toBe(true);
    expect(Util.isMessageInstance).toBeCalledWith(message.member.voice.channel);
    expect(distube.queues.create).toBeCalledWith(message.member.voice.channel, song, message.channel);
  });

  test("Custom text channel", async () => {
    Util.isMessageInstance.mockReturnValue(false);
    Util.isSupportedVoiceChannel.mockReturnValue(true);
    distube.queues.create.mockReturnValue(true);
    const channel: any = { id: "a text channel" };
    const voice: any = { type: "voice" };
    await expect(handler.createQueue(voice, song, channel)).resolves.toBe(true);
    expect(Util.isMessageInstance).toBeCalledWith(voice);
    expect(distube.queues.create).toBeCalledWith(voice, song, channel);
  });
});

describe("DisTubeHandler#getYouTubeInfo()", () => {
  const distube = createFakeDisTube();
  const handler = new DisTubeHandler(distube as any);

  const url = "an URL";
  test("Get basic info", () => {
    handler.getYouTubeInfo(url, true);
    expect(ytdl.getBasicInfo).toBeCalledWith(url, handler.ytdlOptions);
  });
  test("Get full info", () => {
    handler.getYouTubeInfo(url);
    expect(ytdl.getInfo).toBeCalledWith(url, handler.ytdlOptions);
    expect(ytdl.getInfo).toBeCalledTimes(1);
    handler.getYouTubeInfo(url, false);
    expect(ytdl.getInfo).toBeCalledWith(url, handler.ytdlOptions);
    expect(ytdl.getInfo).toBeCalledTimes(2);
  });
});

describe("DisTubeHandler#resolveSong()", () => {
  const distube = createFakeDisTube();
  const handler = new DisTubeHandler(distube as any);

  test("Parameter is null or undefined", async () => {
    await expect(handler.resolveSong(member, null)).resolves.toBe(null);
    await expect(handler.resolveSong(member, null)).resolves.toBe(null);
  });

  test("Parameter is Song or Playlist", async () => {
    await expect(handler.resolveSong(member, playlist)).resolves.toBe(playlist);
  });

  test("Parameter is a SearchResult", async () => {
    await expect(handler.resolveSong(member, songResult)).resolves.toBeInstanceOf(Song);
    (ytpl as unknown as jest.Mock).mockReturnValue(firstPlaylistInfo);
    await expect(handler.resolveSong(member, plResult)).resolves.toBeInstanceOf(Playlist);
  });

  test("Parameter is a song info object", async () => {
    const songInfo = { id: "z", url: "z url", src: "test" };
    await expect(handler.resolveSong(member, songInfo)).resolves.toBeInstanceOf(Song);
  });

  test("Parameter is a youtube url", async () => {
    const url = "a youtube url";
    ytdl.validateURL.mockReturnValue(true);
    ytdl.getInfo.mockReturnValue({ full: true, videoDetails: { id: "test" }, formats: ["a format"] } as any);
    const resolved = handler.resolveSong(member, url);
    await expect(resolved).resolves.toBeInstanceOf(Song);
    expect(ytdl.validateURL).toBeCalledWith(url);
    expect(ytdl.getInfo).toBeCalledWith(url, handler.ytdlOptions);
  });

  test("Parameter is a url supported by an extractor plugin", async () => {
    const url = "an url";
    const result = { id: "a song id" };
    ytdl.validateURL.mockReturnValue(false);
    Util.isURL.mockReturnValue(true);
    extractor.validate.mockReturnValue(true);
    extractor.resolve.mockReturnValue(result);
    await expect(handler.resolveSong(member, url)).resolves.toBe(result);
    expect(extractor.validate).toBeCalledWith(url);
    expect(extractor.resolve).toBeCalledWith(url, member);
  });

  test("Parameter is an unsupported URL", async () => {
    const url = "an url";
    Util.isURL.mockReturnValue(true);
    extractor.validate.mockReturnValue(false);
    await expect(handler.resolveSong(member, url)).rejects.toThrow(new DisTubeError("NOT_SUPPORTED_URL"));
  });

  test("Parameter is a number", async () => {
    const url: any = 1;
    Util.isURL.mockReturnValue(false);
    await expect(handler.resolveSong(member, url)).rejects.toThrow(new DisTubeError("CANNOT_RESOLVE_SONG", typeof url));
  });
});

describe("DisTubeHandler#resolvePlaylist()", () => {
  const distube = createFakeDisTube();
  const handler = new DisTubeHandler(distube as any);

  test("playlist is a Playlist", async () => {
    await expect(handler.resolvePlaylist(member, playlist)).resolves.toBe(playlist);
  });

  test("playlist is a Song array", async () => {
    const result = handler.resolvePlaylist(member, [song, anotherSong, nsfwSong]);
    await expect(result).resolves.toStrictEqual(playlist);
    await expect(result).resolves.not.toBe(playlist);
  });
});

describe("DisTubeHandler#createCustomPlaylist()", () => {
  const distube = createFakeDisTube();
  const handler = new DisTubeHandler(distube as any);

  const message: any = {};
  test("songs is not an array", async () => {
    await expect(handler.createCustomPlaylist(message, "" as any)).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "Array", "", "songs"),
    );
  });

  test("songs is an empty array", async () => {
    await expect(handler.createCustomPlaylist(message, [])).rejects.toThrow(new DisTubeError("EMPTY_ARRAY"));
  });

  test("songs is an array of invalid types", async () => {
    Util.isURL.mockReturnValue(false);
    await expect(handler.createCustomPlaylist(message, [""])).rejects.toThrow(new DisTubeError("NO_VALID_SONG"));
  });

  test("parallel is true", async () => {
    const name = "a custom playlist";
    Util.isURL.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const result = await handler.createCustomPlaylist(message, ["not an url", song, anotherSong, songResult], { name });
    expect(result.songs.length).toBe(3);
    expect(result.songs[0]).toBe(song);
    expect(result.songs[1]).toBe(anotherSong);
    expect(result.songs[2]).toBeInstanceOf(Song);
    expect(result.name).toBe(name);
  });

  test("parallel is false", async () => {
    const name = "a custom playlist";
    Util.isURL.mockReturnValueOnce(true);
    extractor.validate.mockReturnValue(false);
    const result = await handler.createCustomPlaylist(
      message,
      ["not an url", anotherSong, song, plResult],
      { name },
      false,
    );
    expect(result.songs.length).toBe(2);
    expect(result.songs[1]).toBe(song);
    expect(result.songs[0]).toBe(anotherSong);
    expect(result.name).toBe(name);
  });
});

describe("DisTubeHandler#handlePlaylist()", () => {
  const distube = createFakeDisTube();
  const handler = new DisTubeHandler(distube as any);
  const message: any = {};

  test("Invalid Playlist", async () => {
    await expect(handler.handlePlaylist(message, undefined as any)).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "Playlist", undefined, "playlist"),
    );
    await expect(handler.handlePlaylist(message, "not a Playlist" as any)).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "Playlist", "not a Playlist", "playlist"),
    );
  });

  test("No valid video in the playlist", async () => {
    const pl1 = new Playlist([nsfwSong], message);
    await expect(handler.handlePlaylist(message, pl1, { nsfw: false } as any)).rejects.toThrow(
      new DisTubeError("EMPTY_FILTERED_PLAYLIST"),
    );
    const pl2 = new Playlist([new Song({ age_restricted: true, url: "test url" }, member, "test")], message);
    pl2.songs = [];
    await expect(handler.handlePlaylist(message, pl2, { nsfw: true } as any)).rejects.toThrow(
      new DisTubeError("EMPTY_PLAYLIST"),
    );
  });

  test("Play in a nsfw channel", async () => {
    const channel: any = { nsfw: true };
    distube.queues.get.mockReturnValue(undefined);
    handler.createQueue = jest.fn().mockReturnValue(true);
    await expect(handler.handlePlaylist(message, playlist, channel)).resolves.toBeUndefined();
    expect(handler.createQueue).toBeCalledWith(message, playlist.songs, channel);
    expect(distube.emit).not.toBeCalled();
    expect(playlist.songs).toContain(nsfwSong);
  });

  test("Play in a non-nsfw channel", async () => {
    const channel: any = { nsfw: false };
    const queue = new Queue.Queue(distube as any, {} as any, song);
    queue.songs = playlist.songs;
    distube.queues.get.mockReturnValue(undefined);
    handler.createQueue = jest.fn().mockReturnValue(queue);
    await expect(handler.handlePlaylist(message, playlist, channel)).resolves.toBeUndefined();
    expect(handler.createQueue).toBeCalledWith(message, playlist.songs, channel);
    expect(distube.emit).toBeCalledWith("playSong", queue, playlist.songs[0]);
    expect(playlist.songs).not.toContain(nsfwSong);
    playlist.songs.push(nsfwSong);
  });

  test("Skip the playing song", async () => {
    const channel: any = { nsfw: false };
    const queue = new Queue.Queue(distube as any, {} as any, song);
    queue.songs = playlist.songs;
    distube.queues.get.mockReturnValue(queue);
    await expect(handler.handlePlaylist(message, playlist, channel, true, true)).resolves.toBeUndefined();
    expect(queue.addToQueue).toBeCalledWith(playlist.songs, 1);
    expect(queue.skip).toBeCalledTimes(1);
    expect(distube.emit).not.toBeCalled();
    expect(playlist.songs).not.toContain(nsfwSong);
    playlist.songs.push(nsfwSong);
  });

  test("Add the playlist to the beginning of the queue", async () => {
    const channel: any = { nsfw: true };
    const queue = new Queue.Queue(distube as any, {} as any, song);
    queue.songs = playlist.songs;
    distube.queues.get.mockReturnValue(queue);
    await expect(handler.handlePlaylist(message, playlist, channel, false, true)).resolves.toBeUndefined();
    expect(queue.addToQueue).toBeCalledWith(playlist.songs, 1);
    expect(queue.skip).not.toBeCalled();
    expect(distube.emit).toBeCalledWith("addList", queue, playlist);
    expect(playlist.songs).toContain(nsfwSong);
  });

  test("Add the playlist to the end of the queue", async () => {
    const channel: any = { nsfw: true };
    const queue = new Queue.Queue(distube as any, {} as any, song);
    queue.songs = playlist.songs;
    distube.queues.get.mockReturnValue(queue);
    await expect(handler.handlePlaylist(message, playlist, channel, false, false)).resolves.toBeUndefined();
    expect(queue.addToQueue).toBeCalledWith(playlist.songs, -1);
    expect(queue.skip).not.toBeCalled();
    expect(distube.emit).toBeCalledWith("addList", queue, playlist);
    expect(playlist.songs).toContain(nsfwSong);
  });
});

describe("DisTubeHandler#createStream()", () => {
  const distube = createFakeDisTube();
  const handler = new DisTubeHandler(distube as any);

  test("Create a YouTube stream", () => {
    const stream = { key: "value" };
    const mockFn = jest.fn().mockReturnValue(stream);
    Stream.DisTubeStream.YouTube = mockFn;
    song.formats = [];
    song.duration = 1;
    const queue = {
      songs: [song],
      filters: [],
      beginTime: 1,
    };
    const result = handler.createStream(queue as any);
    expect(result).toBe(stream);
    expect(mockFn).toBeCalledWith(
      song.formats,
      expect.objectContaining({
        ffmpegArgs: undefined,
        seek: 1,
      }),
    );
  });

  test("Create a direct link stream", () => {
    const stream = { key: "value" };
    const mockFn = jest.fn().mockReturnValue(stream);
    Stream.DisTubeStream.DirectLink = mockFn;
    anotherSong.streamURL = anotherSong.url;
    const queue = {
      songs: [anotherSong],
      filters: ["3d", "bassboost"],
      beginTime: 1,
    };
    const result = handler.createStream(queue as _Queue.Queue);
    expect(result).toBe(stream);
    expect(mockFn).toBeCalledWith(
      anotherSong.url,
      expect.objectContaining({
        ffmpegArgs: ["-af", `${distube.filters["3d"]},${distube.filters.bassboost}`],
        seek: undefined,
      }),
    );
  });
});

describe("DisTubeHandler#searchSong()", () => {
  test("No result found", async () => {
    const distube = createFakeDisTube();
    const handler = new DisTubeHandler(distube as any);
    const err = new DisTubeError("NO_RESULT");
    distube.search.mockRejectedValue(err);
    const message: any = {};
    const query = "test";
    await expect(handler.searchSong(message, query)).resolves.toBe(null);
    expect(distube.emit).toBeCalledWith("searchNoResult", message, query);
  });

  test("searchSongs option <= 1", async () => {
    const distube = createFakeDisTube();
    const handler = new DisTubeHandler(distube as any);
    distube.options.searchSongs = 0;
    const results = [{}];
    distube.search.mockResolvedValue(results);
    const message: any = { channel: { nsfw: false } };
    const query = "test";
    await expect(handler.searchSong(message, query)).resolves.toBe(results[0]);
    expect(distube.search).toBeCalledWith(
      query,
      expect.objectContaining({
        limit: 1,
        safeSearch: true,
      }),
    );
  });

  describe("searchSongs option > 1", () => {
    const distube = createFakeDisTube();
    distube.options.searchSongs = 5;
    const handler = new DisTubeHandler(distube as any);
    const results = [{}, {}, {}, {}, {}];
    const createV13Message = (answerMessage: any): any => {
      return {
        channel: {
          nsfw: false,
          awaitMessages: (opt: any = {}) =>
            new Promise((resolve, reject) => {
              const a = [answerMessage].filter(opt.filter)[0];
              if (!a || opt.max !== 1) reject();
              resolve({ first: () => answerMessage });
            }),
        },
        author: { id: 1 },
      };
    };
    const createV12Message = (answerMessage: any): any => {
      return {
        channel: {
          nsfw: false,
          awaitMessages: (filter: any, opt: any = {}) =>
            new Promise((resolve, reject) => {
              const a = [answerMessage].filter(filter)[0];
              if (!a || opt.max !== 1) reject();
              resolve({ first: () => answerMessage });
            }),
        },
        author: { id: 1 },
      };
    };

    test("User choose a result (discord.js v13)", async () => {
      distube.options.nsfw = true;
      distube.search.mockResolvedValue(results);
      const ans = { content: "2", author: { id: 1 } };
      const message = createV13Message(ans);
      const query = "query";
      await expect(handler.searchSong(message, query)).resolves.toBe(results[1]);
      expect(distube.search).toBeCalledWith(
        query,
        expect.objectContaining({
          limit: 5,
          safeSearch: false,
        }),
      );
      expect(distube.emit).nthCalledWith(1, "searchResult", message, results, query);
      expect(distube.emit).nthCalledWith(2, "searchDone", message, ans, query);
    });

    test("User choose a result (discord.js v12)", async () => {
      distube.search.mockResolvedValue(results);
      const query = "query";
      const ans = { content: "3", author: { id: 1 } };
      const message = createV12Message(ans);
      await expect(handler.searchSong(message, query)).resolves.toBe(results[2]);
      expect(distube.search).toBeCalledWith(query, expect.objectContaining({ limit: 5 }));
      expect(distube.emit).nthCalledWith(1, "searchResult", message, results, query);
      expect(distube.emit).nthCalledWith(2, "searchDone", message, ans, query);
    });

    test("Message timeout", async () => {
      distube.search.mockResolvedValue(results);
      const ans = { content: "3", author: { id: 2 } };
      const message = createV12Message(ans);
      const query = "query";
      await expect(handler.searchSong(message, query)).resolves.toBe(null);
      expect(distube.emit).nthCalledWith(1, "searchResult", message, results, query);
      expect(distube.emit).nthCalledWith(2, "searchCancel", message, query);
    });

    test("User sends an invalid number", async () => {
      // Bigger than result length
      distube.search.mockResolvedValue(results);
      const ans = { content: "6", author: { id: 1 } };
      const message = createV13Message(ans);
      const query = "query";
      await expect(handler.searchSong(message, query)).resolves.toBe(null);
      expect(distube.emit).nthCalledWith(1, "searchResult", message, results, query);
      expect(distube.emit).nthCalledWith(2, "searchInvalidAnswer", message, ans, query);
      // Smaller than 1
      ans.content = "0";
      await expect(handler.searchSong(message, query)).resolves.toBe(null);
      expect(distube.emit).nthCalledWith(3, "searchResult", message, results, query);
      expect(distube.emit).nthCalledWith(4, "searchInvalidAnswer", message, ans, query);
      // Not a number
      ans.content = "not a number";
      await expect(handler.searchSong(message, query)).resolves.toBe(null);
      expect(distube.emit).nthCalledWith(5, "searchResult", message, results, query);
      expect(distube.emit).nthCalledWith(6, "searchInvalidAnswer", message, ans, query);
    });
  });
});
