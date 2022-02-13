import { firstPlaylistInfo, playlistResults, videoResults } from "./raw";
import { DisTubeError, DisTubeHandler, Playlist, SearchResult, Song, defaultFilters, defaultOptions } from "../..";
import type { DisTubeOptions } from "../..";

import * as _ytpl from "@distube/ytpl";
import * as _ytdl from "@distube/ytdl-core";
import * as _Util from "../../util";
import * as _Queue from "../../struct/Queue";

jest.useFakeTimers();
jest.mock("@distube/ytpl");
jest.mock("@distube/ytdl-core");
jest.mock("../../util");
jest.mock("../../struct/Queue");

const ytpl = _ytpl as unknown as jest.Mocked<typeof _ytpl>;
const ytdl = _ytdl as unknown as jest.Mocked<typeof _ytdl>;
const Util = _Util as unknown as jest.Mocked<typeof _Util>;
const Queue = _Queue as unknown as jest.Mocked<typeof _Queue>;

function createFakeQueueManager() {
  return {
    create: jest.fn(),
    get: jest.fn(),
  };
}

function createFakeVoiceManager() {
  return {
    leave: jest.fn(),
  };
}

const extractor = {
  validate: jest.fn(),
  resolve: jest.fn(),
};

function createFakeDisTube() {
  return {
    options: { ...defaultOptions } as DisTubeOptions,
    filters: defaultFilters,
    queues: createFakeQueueManager(),
    voices: createFakeVoiceManager(),
    emit: jest.fn(),
    extractorPlugins: [extractor],
    search: jest.fn(),
    listenerCount: jest.fn(),
    client: {
      on: jest.fn(),
    },
    createCustomPlaylist: jest.fn(),
  };
}
function createV13Message(answerMessage?: any): any {
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
}
function createV12Message(answerMessage: any): any {
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
}

const member: any = {};
const songResult = new SearchResult(videoResults.items[0] as any);
const plResult = new SearchResult(playlistResults.items[0] as any);
const metadata = { test: "sth" };
const song = new Song({ id: "xxxxxxxxxxx", url: "https://www.youtube.com/watch?v=xxxxxxxxxxx" }, { member, metadata });
const anotherSong = new Song(
  { id: "y", url: "https://www.youtube.com/watch?v=y" },
  { member, source: "test", metadata },
);
const nsfwSong = new Song({ id: "z", url: "z url", age_restricted: true }, { member, source: "test", metadata });
const playlist = new Playlist([song, anotherSong, nsfwSong], { member, metadata });

beforeEach(() => {
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

  describe("leaveOnEmpty option", () => {
    test("Disabled option", () => {
      const distube = createFakeDisTube();
      distube.options.leaveOnEmpty = false;
      new DisTubeHandler(distube as any);
      expect(distube.client.on).not.toBeCalled();
    });

    const distube = createFakeDisTube();
    distube.options.leaveOnEmpty = true;
    new DisTubeHandler(distube as any);
    const stateHandle = distube.client.on.mock.calls[0][1];

    test("Client is not in a voice channel", () => {
      stateHandle(undefined);
      stateHandle({ channel: undefined });
      expect(distube.queues.get).not.toBeCalled();
    });

    describe("There is no playing Queue in the guild", () => {
      distube.queues.get.mockReturnValue(undefined);
      const state = { channel: {} };

      test("The voice channel is not empty", () => {
        Util.isVoiceChannelEmpty.mockReturnValue(false);
        stateHandle(state);
        expect(jest.getTimerCount()).toBe(0);
      });

      describe("The voice channel is empty", () => {
        test("The voice channel is still empty after timeout", () => {
          Util.isVoiceChannelEmpty.mockReturnValue(true);
          stateHandle(state);
          expect(jest.getTimerCount()).toBe(1);
          expect(distube.voices.leave).not.toBeCalled();
          jest.runAllTimers();
          expect(distube.voices.leave).toBeCalledWith(state);
        });

        test("The voice channel is not empty after timeout", () => {
          Util.isVoiceChannelEmpty.mockReturnValue(false).mockReturnValueOnce(true);
          stateHandle(state);
          expect(jest.getTimerCount()).toBe(1);
          expect(distube.voices.leave).not.toBeCalled();
          jest.runAllTimers();
          expect(distube.voices.leave).not.toBeCalled();
        });

        test("A queue is created after timeout", () => {
          Util.isVoiceChannelEmpty.mockReturnValue(true);
          stateHandle(state);
          expect(jest.getTimerCount()).toBe(1);
          expect(distube.voices.leave).not.toBeCalled();
          distube.queues.get.mockReturnValueOnce({});
          jest.runAllTimers();
          expect(distube.voices.leave).not.toBeCalled();
        });
      });
    });

    describe("There is a playing Queue in the guild", () => {
      const queue = { voice: { leave: jest.fn() }, stopped: false, remove: jest.fn() };
      const state = { channel: {} };
      describe("The voice channel is not empty", () => {
        distube.queues.get.mockReturnValue(queue);
        Util.isVoiceChannelEmpty.mockReturnValueOnce(false);
        stateHandle(state);
        expect(jest.getTimerCount()).toBe(0);
      });
      describe("The voice channel is empty", () => {
        test("The voice channel is still empty after timeout", () => {
          distube.queues.get.mockReturnValue(queue);
          Util.isVoiceChannelEmpty.mockReturnValue(true);
          stateHandle(state);
          expect(jest.getTimerCount()).toBe(1);
          expect(queue.voice.leave).not.toBeCalled();
          jest.runAllTimers();
          expect(queue.voice.leave).toBeCalledTimes(1);
          expect(queue.remove).not.toBeCalled();
          // Stopped queue
          queue.stopped = true;
          stateHandle(state);
          expect(jest.getTimerCount()).toBe(1);
          expect(queue.voice.leave).toBeCalledTimes(1);
          jest.runAllTimers();
          expect(queue.voice.leave).toBeCalledTimes(2);
          expect(queue.remove).toBeCalledTimes(1);
          queue.stopped = false;
        });

        test("The voice channel is not empty after timeout", () => {
          distube.queues.get.mockReturnValue(queue);
          Util.isVoiceChannelEmpty.mockReturnValue(false).mockReturnValueOnce(true);
          stateHandle(state);
          expect(jest.getTimerCount()).toBe(1);
          expect(queue.voice.leave).not.toBeCalled();
          // Test clear previous timeout
          Util.isVoiceChannelEmpty.mockReturnValueOnce(true);
          stateHandle(state);
          expect(jest.getTimerCount()).toBe(1);
          jest.runAllTimers();
          expect(queue.voice.leave).not.toBeCalled();
        });
      });
    });
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
    await expect(handler.resolveSong(null, { member, metadata })).rejects.toThrowError(
      new DisTubeError("CANNOT_RESOLVE_SONG", null),
    );
    await expect(handler.resolveSong(undefined, { member, metadata })).rejects.toThrowError(
      new DisTubeError("CANNOT_RESOLVE_SONG", undefined),
    );
  });

  test("Parameter is Song or Playlist", async () => {
    await expect(handler.resolveSong(song, { member, metadata })).resolves.toBe(song);
    await expect(handler.resolveSong(playlist, { member, metadata })).resolves.toBe(playlist);
  });

  test("Parameter is a SearchResult", async () => {
    Util.isRecord.mockReturnValue(true);
    await expect(handler.resolveSong(songResult, { member, metadata })).resolves.toBeInstanceOf(Song);
    (ytpl as unknown as jest.Mock).mockReturnValue(firstPlaylistInfo);
    await expect(handler.resolveSong(plResult, { member, metadata })).resolves.toBeInstanceOf(Playlist);
  });

  test("Parameter is a song info object", async () => {
    const songInfo = { id: "z", url: "z url", src: "test" };
    Util.isObject.mockReturnValue(true);
    await expect(handler.resolveSong(songInfo, { member, metadata })).resolves.toBeInstanceOf(Song);
  });

  test("Parameter is a youtube url", async () => {
    const url = "a youtube url";
    ytdl.validateURL.mockReturnValue(true);
    ytdl.getInfo.mockReturnValue({ full: true, videoDetails: { id: "test" }, formats: ["a format"] } as any);
    const resolved = handler.resolveSong(url, { member, metadata });
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
    const otp = { member, metadata };
    await expect(handler.resolveSong(url, otp)).resolves.toBe(result);
    expect(extractor.validate).toBeCalledWith(url);
    expect(extractor.resolve).toBeCalledWith(url, otp);
  });

  test("Parameter is an unsupported URL", async () => {
    const url = "an url";
    Util.isURL.mockReturnValue(true);
    extractor.validate.mockReturnValue(false);
    await expect(handler.resolveSong(url)).rejects.toThrow(new DisTubeError("NOT_SUPPORTED_URL"));
  });

  test("Parameter is a number", async () => {
    const url: any = 1;
    Util.isURL.mockReturnValue(false);
    await expect(handler.resolveSong(url)).rejects.toThrow(new DisTubeError("CANNOT_RESOLVE_SONG", url));
  });
});

describe("DisTubeHandler#resolvePlaylist()", () => {
  const distube = createFakeDisTube();
  const handler = new DisTubeHandler(distube as any);

  test("playlist is a Playlist", async () => {
    await expect(handler.resolvePlaylist(playlist)).resolves.toBe(playlist);
  });

  test("playlist is a Song array", async () => {
    Util.isRecord.mockReturnValue(true);
    const result = handler.resolvePlaylist([song, anotherSong, nsfwSong], { member, metadata });
    await expect(result).resolves.toStrictEqual(playlist);
    await expect(result).resolves.not.toBe(playlist);
  });
});

describe("DisTubeHandler#handlePlaylist()", () => {
  const distube = createFakeDisTube();
  const handler = new DisTubeHandler(distube as any);
  const voice: any = {};

  test("Invalid Playlist", async () => {
    await expect(handler.handlePlaylist(voice, undefined as any)).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "Playlist", undefined, "playlist"),
    );
    await expect(handler.handlePlaylist(voice, "not a Playlist" as any)).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "Playlist", "not a Playlist", "playlist"),
    );
  });

  test("No valid video in the playlist", async () => {
    const pl1 = new Playlist([nsfwSong]);
    await expect(handler.handlePlaylist(voice, pl1, { textChannel: { nsfw: false } } as any)).rejects.toThrow(
      new DisTubeError("EMPTY_FILTERED_PLAYLIST"),
    );
    const pl2 = new Playlist([new Song({ age_restricted: true, url: "test url" }, { member, source: "test" })]);
    pl2.songs = [];
    await expect(handler.handlePlaylist(voice, pl2, { textChannel: { nsfw: true } } as any)).rejects.toThrow(
      new DisTubeError("EMPTY_PLAYLIST"),
    );
  });

  test("Play in a nsfw channel", async () => {
    const textChannel: any = { nsfw: true };
    distube.queues.get.mockReturnValue(undefined);
    distube.queues.create.mockReturnValueOnce(true);
    await expect(handler.handlePlaylist(voice, playlist, { textChannel })).resolves.toBeUndefined();
    expect(distube.queues.create).toBeCalledWith(voice, playlist.songs, textChannel);
    expect(distube.emit).not.toBeCalled();
    expect(playlist.songs).toContain(nsfwSong);
    const queue = new Queue.Queue(distube as any, {} as any, playlist.songs);
    queue.songs = playlist.songs;
    distube.options.emitAddListWhenCreatingQueue = false;
    distube.queues.create.mockReturnValueOnce(queue);
    await expect(handler.handlePlaylist(voice, playlist, { textChannel })).resolves.toBeUndefined();
    expect(distube.queues.create).toBeCalledWith(voice, playlist.songs, textChannel);
    expect(distube.emit).not.toBeCalledWith("addList", queue, playlist);
    expect(distube.emit).toBeCalledWith("playSong", queue, playlist.songs[0]);
    expect(playlist.songs).toContain(nsfwSong);
    distube.options.emitAddListWhenCreatingQueue = true;
  });

  test("Play in a non-nsfw channel", async () => {
    const textChannel: any = { nsfw: false };
    const queue = new Queue.Queue(distube as any, {} as any, song);
    queue.songs = playlist.songs;
    distube.queues.get.mockReturnValue(undefined);
    distube.queues.create.mockReturnValue(queue);
    await expect(handler.handlePlaylist(voice, playlist, { textChannel })).resolves.toBeUndefined();
    expect(distube.queues.create).toBeCalledWith(voice, playlist.songs, textChannel);
    expect(distube.emit).nthCalledWith(1, "addList", queue, playlist);
    expect(distube.emit).nthCalledWith(2, "playSong", queue, playlist.songs[0]);
    expect(playlist.songs).not.toContain(nsfwSong);
    playlist.songs.push(nsfwSong);
  });

  test("Skip the playing song", async () => {
    const textChannel: any = { nsfw: false };
    const queue = new Queue.Queue(distube as any, {} as any, song);
    queue.songs = playlist.songs;
    distube.queues.get.mockReturnValue(queue);
    await expect(
      handler.handlePlaylist(voice, playlist, { textChannel, skip: true, position: 1 }),
    ).resolves.toBeUndefined();
    expect(queue.addToQueue).toBeCalledWith(playlist.songs, 1);
    expect(queue.skip).toBeCalledTimes(1);
    expect(distube.emit).not.toBeCalled();
    expect(playlist.songs).not.toContain(nsfwSong);
    playlist.songs.push(nsfwSong);
  });

  test("Add the playlist to the beginning of the queue", async () => {
    const textChannel: any = { nsfw: true };
    const queue = new Queue.Queue(distube as any, {} as any, song);
    queue.songs = playlist.songs;
    distube.queues.get.mockReturnValue(queue);
    await expect(
      handler.handlePlaylist(voice, playlist, { textChannel, skip: false, position: 1 }),
    ).resolves.toBeUndefined();
    expect(queue.addToQueue).toBeCalledWith(playlist.songs, 1);
    expect(queue.skip).not.toBeCalled();
    expect(distube.emit).toBeCalledWith("addList", queue, playlist);
    expect(playlist.songs).toContain(nsfwSong);
  });

  test("Add the playlist to the end of the queue", async () => {
    const textChannel: any = { nsfw: true };
    const queue = new Queue.Queue(distube as any, {} as any, song);
    queue.songs = playlist.songs;
    distube.queues.get.mockReturnValue(queue);
    await expect(handler.handlePlaylist(voice, playlist, { textChannel, skip: false })).resolves.toBeUndefined();
    expect(queue.addToQueue).toBeCalledWith(playlist.songs, 0);
    expect(queue.skip).not.toBeCalled();
    expect(distube.emit).toBeCalledWith("addList", queue, playlist);
    expect(playlist.songs).toContain(nsfwSong);
  });
});

describe("DisTubeHandler#searchSong()", () => {
  test("Validate parameter", async () => {
    const distube = createFakeDisTube();
    const handler = new DisTubeHandler(distube as any);
    Util.isMessageInstance.mockReturnValue(true);
    Util.isMessageInstance.mockReturnValueOnce(false);
    await expect(handler.searchSong(null, "")).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "Discord.Message", null, "message"),
    );
    const message = createV13Message();
    await expect(handler.searchSong(message, 0 as any)).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "string", 0, "query"),
    );
    await expect(handler.searchSong(message, "")).rejects.toThrow(new DisTubeError("EMPTY_STRING", "query"));
  });
  describe("No result found", () => {
    test("With listening searchNoResult event", async () => {
      Util.isMessageInstance.mockReturnValue(true);
      const distube = createFakeDisTube();
      distube.emit.mockReturnValue(true);
      const handler = new DisTubeHandler(distube as any);
      const err = new DisTubeError("NO_RESULT");
      distube.search.mockRejectedValue(err);
      const message: any = {};
      const query = "test";
      await expect(handler.searchSong(message, query)).resolves.toBe(null);
      expect(distube.emit).toBeCalledWith("searchNoResult", message, query);
    });

    test("Without listening searchNoResult event", async () => {
      Util.isMessageInstance.mockReturnValue(true);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const distube = createFakeDisTube();
      distube.emit.mockReturnValue(false);
      const handler = new DisTubeHandler(distube as any);
      const err = new DisTubeError("NO_RESULT");
      distube.search.mockRejectedValue(err);
      const message: any = {};
      const query = "test";
      await expect(handler.searchSong(message, query)).rejects.toThrow(err);
      expect(distube.emit).toBeCalledWith("searchNoResult", message, query);
      expect(warn).toBeCalledWith("searchNoResult event does not have any listeners! Emits `error` event instead.");
    });
  });

  test("searchSongs option <= 1", async () => {
    Util.isMessageInstance.mockReturnValue(true);
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

    test("User choose a result", async () => {
      Util.isMessageInstance.mockReturnValue(true);
      distube.listenerCount.mockReturnValue(true);
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
      expect(distube.listenerCount).toBeCalledWith("searchNoResult");
      expect(distube.listenerCount).toBeCalledWith("searchResult");
      expect(distube.listenerCount).toBeCalledWith("searchCancel");
      expect(distube.listenerCount).toBeCalledWith("searchInvalidAnswer");
      expect(distube.listenerCount).toBeCalledWith("searchDone");
    });

    test("Message timeout", async () => {
      Util.isMessageInstance.mockReturnValue(true);
      distube.listenerCount.mockReturnValue(true);
      distube.search.mockResolvedValue(results);
      const ans = { content: "3", author: { id: 2 } };
      const message = createV12Message(ans);
      const query = "query";
      await expect(handler.searchSong(message, query)).resolves.toBe(null);
      expect(distube.emit).nthCalledWith(1, "searchResult", message, results, query);
      expect(distube.emit).nthCalledWith(2, "searchCancel", message, query);
      expect(distube.listenerCount).toBeCalledWith("searchNoResult");
      expect(distube.listenerCount).toBeCalledWith("searchResult");
      expect(distube.listenerCount).toBeCalledWith("searchCancel");
      expect(distube.listenerCount).toBeCalledWith("searchInvalidAnswer");
      expect(distube.listenerCount).toBeCalledWith("searchDone");
    });

    test("User sends an invalid number", async () => {
      Util.isMessageInstance.mockReturnValue(true);
      distube.listenerCount.mockReturnValue(true);
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
      expect(distube.listenerCount).toBeCalledWith("searchNoResult");
      expect(distube.listenerCount).toBeCalledWith("searchResult");
      expect(distube.listenerCount).toBeCalledWith("searchCancel");
      expect(distube.listenerCount).toBeCalledWith("searchInvalidAnswer");
      expect(distube.listenerCount).toBeCalledWith("searchDone");
    });

    test("Disabled `searchSongs` due to missing listener", async () => {
      Util.isMessageInstance.mockReturnValue(true);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const events = ["searchNoResult", "searchResult", "searchCancel", "searchInvalidAnswer", "searchDone"];
      distube.search.mockResolvedValue(results);
      for (const evn of events) {
        distube.listenerCount = ((e: string) => (e === evn ? 0 : 1)) as any;
        distube.options.searchSongs = 5;
        const ans = { content: "2", author: { id: 1 } };
        const message = createV13Message(ans);
        const query = "query";
        await expect(handler.searchSong(message, query)).resolves.toBe(results[0]);
        expect(warn).toBeCalledWith(`"searchSongs" option is disabled due to missing "${evn}" listener.`);
        expect(distube.options.searchSongs).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe("DisTubeHandler#createSearchMessageCollector()", () => {
  test("Validate parameter", async () => {
    const distube = createFakeDisTube();
    const handler = new DisTubeHandler(distube as any);
    Util.isMessageInstance.mockReturnValue(true);
    Util.isMessageInstance.mockReturnValueOnce(false);
    await expect(handler.createSearchMessageCollector(null, null)).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "Discord.Message", null, "message"),
    );
    await expect(handler.createSearchMessageCollector(null, null)).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "Array<SearchResult|Song|Playlist>", null, "results"),
    );
  });
});
