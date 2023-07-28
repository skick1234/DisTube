import {
  DisTubeError,
  QueueManager,
  Song,
  DisTubeVoiceManager as _DTVM,
  Queue as _Queue,
  defaultFilters,
  defaultOptions,
} from "@";

import * as _Stream from "@/core/DisTubeStream";

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("@/struct/Queue", () => require("@/mock/Queue"));
jest.mock("@/core/DisTubeStream");
jest.mock("@/core/manager/DisTubeVoiceManager");

const Queue = _Queue as unknown as jest.Mocked<typeof _Queue>;
const Stream = _Stream as unknown as jest.Mocked<typeof _Stream>;
const DisTubeVoiceManager = _DTVM as unknown as jest.Mocked<typeof _DTVM>;

function createFakeDisTube() {
  return {
    options: { ...defaultOptions },
    voices: new DisTubeVoiceManager(this),
    emit: jest.fn(),
    emitError: jest.fn(),
    filters: defaultFilters,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

const guild = { id: "123456789123456789", ownerId: "987654321234567890" };
const channel: any = { guildId: guild.id, guild };
const textChannel: any = { guildId: guild.id, guild };
const song = 0 as any as Song;
const songs = [1, 2, 3, 4, 5] as any as Song[];
const distube = createFakeDisTube();
const fakeVoice = { id: guild.id, join: jest.fn(), on: jest.fn().mockReturnThis() };
distube.voices.create = jest.fn().mockReturnValue(fakeVoice);

describe("QueueManager#create()", () => {
  test("Create a queue in a guild has another one", async () => {
    const queues = new QueueManager(distube as any);
    queues.add(channel.guild.id, {} as any as _Queue);

    await expect(queues.create(channel, song)).rejects.toThrow(new DisTubeError("QUEUE_EXIST"));
  });

  test("Create a new queue with a song", async () => {
    const queues = new QueueManager(distube as any);
    queues.playSong = jest.fn().mockReturnValue(false);

    await expect(queues.create(channel, song, textChannel)).resolves.toBeInstanceOf(Queue);
    expect(queues.playSong).toBeCalledTimes(1);
    expect(queues.playSong).toBeCalledWith(expect.any(Queue));
    const queue: _Queue = (queues.playSong as jest.Mock).mock.calls[0][0];
    expect(distube.voices.create).toBeCalledTimes(1);
    expect(distube.voices.create).toBeCalledWith(channel);
    expect(fakeVoice.join).toBeCalledTimes(1);
    expect(queues.has(channel)).toBe(true);
    expect(distube.emit).nthCalledWith(1, "initQueue", queue);
    expect(queue._taskQueue.queuing).toBeCalledTimes(1);
    expect(queue._taskQueue.resolve).toBeCalledTimes(1);

    expect(fakeVoice.on).nthCalledWith(1, "disconnect", expect.any(Function));
    fakeVoice.on.mock.calls[0][1]();
    expect(queue.remove).toBeCalledTimes(1);
    expect(distube.emit).nthCalledWith(2, "disconnect", queue);
    const err1 = {};
    fakeVoice.on.mock.calls[0][1](err1);
    expect(queue.remove).toBeCalledTimes(2);
    expect(distube.emitError).nthCalledWith(1, err1, textChannel);

    expect(fakeVoice.on).nthCalledWith(2, "error", expect.any(Function));
    const err2 = {};
    fakeVoice.on.mock.calls[1][1](err2);
    expect(queue.stop).toBeCalledTimes(1);
    expect(distube.emitError).nthCalledWith(2, err2, textChannel);

    expect(fakeVoice.on).nthCalledWith(3, "finish", expect.any(Function));
    queues.remove(channel);
    queues.playSong = jest.fn().mockReturnValue(true);
    await expect(queues.create(channel, song)).resolves.toBe(true);
  });

  test("Create a new queue with an array of song", async () => {
    const queues = new QueueManager(distube as any);
    queues.playSong = jest.fn().mockResolvedValue(false);

    await expect(queues.create(channel, songs, textChannel)).resolves.toBeInstanceOf(Queue);
    expect(queues.playSong).toBeCalledTimes(1);
    expect(queues.playSong).toBeCalledWith(expect.any(Queue));
    const queue: _Queue = (queues.playSong as jest.Mock).mock.calls[0][0];
    expect(distube.voices.create).toBeCalledTimes(1);
    expect(distube.voices.create).toBeCalledWith(channel);
    expect(fakeVoice.join).toBeCalledTimes(1);
    expect(queues.has(channel)).toBe(true);
    expect(distube.emit).nthCalledWith(1, "initQueue", queue);
    expect(queue._taskQueue.queuing).toBeCalledTimes(1);
    expect(queue._taskQueue.resolve).toBeCalledTimes(1);

    expect(fakeVoice.on).nthCalledWith(1, "disconnect", expect.any(Function));
    fakeVoice.on.mock.calls[0][1]();
    expect(queue.remove).toBeCalledTimes(1);
    expect(distube.emit).nthCalledWith(2, "disconnect", queue);
    const err1 = {};
    fakeVoice.on.mock.calls[0][1](err1);
    expect(queue.remove).toBeCalledTimes(2);
    expect(distube.emit).nthCalledWith(3, "disconnect", queue);
    expect(distube.emitError).nthCalledWith(1, err1, textChannel);

    expect(fakeVoice.on).nthCalledWith(2, "error", expect.any(Function));
    const err2 = {};
    fakeVoice.on.mock.calls[1][1](err2);
    await (queues.playSong as jest.Mock).mock.results[1].value;
    expect(queue.stop).not.toBeCalled();
    expect(distube.emitError).nthCalledWith(2, err2, textChannel);
    expect(queues.playSong).toBeCalledTimes(2);
    expect(distube.emit).nthCalledWith(4, "playSong", queue, songs[1]);
    (queues.playSong as jest.Mock).mockResolvedValue(true);
    const err3 = {};
    fakeVoice.on.mock.calls[1][1](err3);
    expect(distube.emitError).nthCalledWith(3, err3, textChannel);
    expect(queues.playSong).toBeCalledTimes(3);
    expect(distube.emit).toBeCalledTimes(4);

    expect(fakeVoice.on).nthCalledWith(3, "finish", expect.any(Function));
    await fakeVoice.on.mock.calls[2][1](err3);
    expect(distube.emit).nthCalledWith(5, "finishSong", queue, songs[2]);
    expect(queue._taskQueue.queuing).toBeCalledTimes(2);
    expect(queue._taskQueue.resolve).toBeCalledTimes(2);

    expect(queues.playSong).toBeCalledWith(queue);
  });
});

describe("QueueManager#createStream()", () => {
  test("Create a YouTube stream", async () => {
    const song = new Song(<any>{ id: "xxxxxxxxxxx", url: "https://www.youtube.com/watch?v=xxxxxxxxxxx" });
    const stream = { key: "value" };
    const queues = new QueueManager(distube as any);
    queues.playSong = jest.fn().mockReturnValue(false);
    const queue = await queues.create(channel, []);
    if (queue === true) throw new Error("Failed to create queue");
    const mockFn = jest.fn().mockReturnValue(stream);
    Stream.DisTubeStream.YouTube = mockFn;
    song.formats = [];
    song.duration = 1;
    queue.songs = [song];
    queue.beginTime = 1;
    const result = queues.createStream(queue as any);
    expect(result).toBe(stream);
    expect(mockFn).toBeCalledTimes(1);
    expect(mockFn).toBeCalledWith(
      song.formats,
      expect.objectContaining({
        ffmpegArgs: [],
        seek: 1,
      }),
    );
  });

  test("Create a direct link stream", async () => {
    const song = new Song(<any>{ id: "y", url: "https://www.not-youtube.com/watch?v=y" }, { source: "not-youtube" });
    const stream = { key2: "value2" };
    const queues = new QueueManager(distube as any);
    (<any>distube).queues = queues;
    queues.playSong = jest.fn().mockReturnValue(false);
    const queue = await queues.create(channel, []);
    if (queue === true) throw new Error("Failed to create queue");
    const mockFn = jest.fn().mockReturnValue(stream);
    Stream.DisTubeStream.DirectLink = mockFn;
    song.streamURL = song.url;
    queue.songs = [song];
    queue.beginTime = 1;
    queue.filters.add(["3d", "bassboost"]);
    const result = queues.createStream(queue as _Queue);
    expect(result).toBe(stream);
    expect(mockFn).toBeCalledTimes(1);
    expect(mockFn).toBeCalledWith(
      song.url,
      expect.objectContaining({
        ffmpegArgs: ["-af", `${distube.filters["3d"]},${distube.filters.bassboost}`],
        seek: undefined,
      }),
    );
    delete (<any>distube).queues;
  });
});
