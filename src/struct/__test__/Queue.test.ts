import { DisTubeError, Queue, Song, defaultFilters, defaultOptions } from "../..";

function createFakeHandler() {
  return {
    resolveSong: jest.fn(),
  };
}

function createFakeQueueManager() {
  return {
    delete: jest.fn(),
    playSong: jest.fn(),
  };
}

function createFakeDisTube() {
  return {
    options: { ...defaultOptions },
    filters: defaultFilters,
    handler: createFakeHandler(),
    queues: createFakeQueueManager(),
    emit: jest.fn(),
  };
}

const fakeClientMember: {
  id: string;
  voice?: any;
  user?: any;
} = {
  id: "222222222222222222",
  user: { id: "222222222222222222" },
};
const fakeVoiceChannel = {
  id: "000000000000000000",
  type: "voice",
  guild: {
    id: "111111111111111111",
    me: fakeClientMember,
  },
};
const voice = {
  channel: fakeVoiceChannel,
  id: "333333333333333333",
  stop: jest.fn(),
  pause: jest.fn(),
  unpause: jest.fn(),
  leave: jest.fn(),
  playbackDuration: 1,
  volume: 50,
};
fakeClientMember.voice = voice;
const song = new Song({ id: "xxxxxxxxxxx", url: "https://www.youtube.com/watch?v=xxxxxxxxxxx" }, {} as any, "test");
const anotherSong = new Song({ id: "y", url: "https://www.youtube.com/watch?v=y" }, {} as any, "test");

afterEach(() => {
  jest.resetAllMocks();
  song.related = [anotherSong];
});

test("Create a queue with a song", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, song);
  expect(queue.clientMember).toBe(fakeClientMember);
  expect(queue.voiceChannel).toBe(fakeVoiceChannel);
  expect(queue.voice).toBe(voice);
  expect(queue.songs).toContain(song);
  expect(queue.formattedDuration).toEqual(song.formattedDuration);
  expect(queue.formattedCurrentTime).toEqual("00:01");
});

test("Create a queue with a playlist", () => {
  const distube = createFakeDisTube();
  const songs: any[] = ["song1", "song2"];
  const queue = new Queue(distube as any, voice as any, songs);
  expect(queue.clientMember).toBe(fakeClientMember);
  expect(queue.voiceChannel).toBe(fakeVoiceChannel);
  expect(queue.voice).toBe(voice);
  expect(queue.songs).toContain("song1");
  expect(queue.songs).toContain("song2");
});

test("Getters", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, []);
  expect(queue.formattedDuration).toBe("00:00");
});

describe("Queue#addRelatedSong()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, song);

  test("Add a related song", async () => {
    queue.addToQueue = jest.fn();
    distube.handler.resolveSong.mockReturnValue(song);
    await expect(queue.addRelatedSong()).resolves.toBe(song);
    expect(distube.handler.resolveSong).toBeCalledTimes(1);
    expect(queue.addToQueue).toBeCalledTimes(1);
  });

  test("Cannot resolve related song", async () => {
    distube.handler.resolveSong.mockReturnValue(null);
    await expect(queue.addRelatedSong()).rejects.toThrow(new DisTubeError("CANNOT_PLAY_RELATED"));
  });

  test("No related song", async () => {
    queue.previousSongs.push(anotherSong);
    await expect(queue.addRelatedSong()).rejects.toThrow(new DisTubeError("NO_RELATED"));
    queue.songs[0].related = [];
    await expect(queue.addRelatedSong()).rejects.toThrow(new DisTubeError("NO_RELATED"));
  });

  test("No playing song", async () => {
    queue.songs = [];
    await expect(queue.addRelatedSong()).rejects.toThrow(new DisTubeError("NO_PLAYING"));
  });
});

describe("Queue#addToQueue()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, [0, 1, 2, 3] as any);

  test("Add a song to the end of the queue", () => {
    const songToAdd = 4 as any;
    expect(queue.addToQueue(songToAdd)).toBe(queue);
    expect(queue.songs[queue.songs.length - 1]).toBe(songToAdd);
  });

  test("Add a song array to the end of the queue", () => {
    const songToAdd = [5, 6] as any;
    expect(queue.addToQueue(songToAdd)).toBe(queue);
    expect(queue.songs[queue.songs.length - 2]).toBe(songToAdd[0]);
    expect(queue.songs[queue.songs.length - 1]).toBe(songToAdd[1]);
  });

  test("Add a song to a position in the queue", () => {
    const songToAdd = -1 as any;
    const position = 2;
    expect(queue.addToQueue(songToAdd, position)).toBe(queue);
    expect(queue.songs[position]).toBe(songToAdd);
  });

  test("Add a song array to a position in the queue", () => {
    const songToAdd = [-2, -3] as any;
    const position = 3;
    expect(queue.addToQueue(songToAdd, position)).toBe(queue);
    expect(queue.songs[position]).toBe(songToAdd[0]);
    expect(queue.songs[position + 1]).toBe(songToAdd[1]);
  });

  test("Add an empty array", () => {
    expect(() => {
      queue.addToQueue([]);
    }).toThrow(new DisTubeError("INVALID_TYPE", ["Song", "SearchResult", "Array<Song|SearchResult>"], [], "song"));
  });

  test("Add to the playing position", () => {
    expect(() => {
      queue.addToQueue(song, 0);
    }).toThrow(new DisTubeError("ADD_BEFORE_PLAYING"));
  });
});

describe("Queue#stop()", () => {
  const distube = createFakeDisTube();

  test("leaveOnStop option is enabled", async () => {
    distube.options.leaveOnStop = true;
    const queue = new Queue(distube as any, voice as any, song);
    queue.delete = jest.fn();
    await queue.stop();
    expect(queue.stopped).toBe(true);
    expect(queue.delete).toBeCalledTimes(1);
    expect(voice.stop).toBeCalledTimes(1);
    expect(voice.leave).toBeCalledTimes(1);
  });

  test("leaveOnStop option is disabled", async () => {
    distube.options.leaveOnStop = false;
    const queue = new Queue(distube as any, voice as any, song);
    queue.delete = jest.fn();
    await queue.stop();
    expect(queue.stopped).toBe(true);
    expect(queue.delete).toBeCalledTimes(1);
    expect(voice.stop).toBeCalledTimes(1);
    expect(voice.leave).not.toBeCalled();
  });
});

describe("Queue#jump()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, [song, anotherSong, song, anotherSong, song, anotherSong]);

  const dt = createFakeDisTube();
  const q = new Queue(dt as any, voice as any, [song, anotherSong, song, anotherSong, song, anotherSong]);
  dt.options.savePreviousSongs = false;

  describe("Jump to a next position", () => {
    test("savePreviousSongs is enabled", async () => {
      const position = 5;
      const playingSong = queue.songs[0];
      const songAtThisPosition = queue.songs[position - 1];
      await expect(queue.jump(position)).resolves.toBe(queue);
      expect(queue.songs[0]).toBe(songAtThisPosition);
      expect(queue.previousSongs[0]).toBe(playingSong);
      expect(queue.next).toBe(true);
      expect(voice.stop).toBeCalledTimes(1);
    });

    test("savePreviousSongs is disabled", async () => {
      const position = 3;
      const playingSong = q.songs[0];
      const songAtThisPosition = q.songs[position - 1];
      await expect(q.jump(position)).resolves.toBe(q);
      expect(q.songs[0]).toBe(songAtThisPosition);
      expect(q.previousSongs[0]).toEqual({ id: playingSong.id });
      expect(q.next).toBe(true);
      expect(voice.stop).toBeCalledTimes(1);
    });
  });

  describe("Jump to a previous position", () => {
    test("Play the previous song", async () => {
      const position = -1;
      const previousSongs = queue.previousSongs;
      const nextSongs = queue.songs;
      await expect(queue.jump(position)).resolves.toBe(queue);
      expect(queue.prev).toBe(true);
      expect(queue.songs).toEqual(nextSongs);
      expect(queue.previousSongs).toEqual(previousSongs);
      expect(voice.stop).toBeCalledTimes(1);
    });

    test("savePreviousSongs is enabled", async () => {
      const position = -2;
      const playingSong = queue.songs[0];
      const songAtThisPosition = queue.previousSongs[queue.previousSongs.length + position];
      await expect(queue.jump(position)).resolves.toBe(queue);
      expect(queue.previousSongs[queue.previousSongs.length - 1]).toBe(songAtThisPosition);
      expect(queue.songs[-1 - position]).toBe(playingSong);
      expect(queue.prev).toBe(true);
      expect(voice.stop).toBeCalledTimes(1);
    });

    test("savePreviousSongs is disabled", async () => {
      await expect(q.jump(-1)).rejects.toThrow(new DisTubeError("DISABLED_OPTION", "savePreviousSongs"));
    });
  });

  test("Jump to string position", async () => {
    const position: any = "1";
    await expect(queue.jump(position)).rejects.toThrow(
      new DisTubeError("INVALID_TYPE", "number", position, "position"),
    );
  });

  test("Jump to NaN position", async () => {
    const position: any = NaN;
    await expect(queue.jump(position)).rejects.toThrow(new DisTubeError("NO_SONG_POSITION"));
  });
});

describe("Queue#skip()", () => {
  const distube = createFakeDisTube();

  test("Skip to the next song", async () => {
    const queue = new Queue(distube as any, voice as any, [anotherSong, song]);
    await expect(queue.skip()).resolves.toBe(song);
    expect(queue.next).toBe(true);
    expect(voice.stop).toBeCalledTimes(1);
  });

  describe("No song to skip", () => {
    test("Autoplay is enabled", async () => {
      const queue = new Queue(distube as any, voice as any, song);
      queue.autoplay = true;
      distube.handler.resolveSong.mockReturnValue(anotherSong);
      await expect(queue.skip()).resolves.toBe(anotherSong);
      expect(queue.songs[1]).toBe(anotherSong);
      expect(queue.next).toBe(true);
      expect(voice.stop).toBeCalledTimes(1);
    });

    test("Autoplay is enabled and cannot get the related song", async () => {
      const queue = new Queue(distube as any, voice as any, song);
      queue.autoplay = true;
      distube.handler.resolveSong.mockRejectedValue(new DisTubeError("NO_UP_NEXT"));
      await expect(queue.skip()).rejects.toThrow(new DisTubeError("NO_UP_NEXT"));
      expect(queue.next).toBe(false);
      expect(voice.stop).toBeCalledTimes(0);
    });

    test("Autoplay is disabled", async () => {
      const queue = new Queue(distube as any, voice as any, song);
      queue.autoplay = false;
      await expect(queue.skip()).rejects.toThrow(new DisTubeError("NO_UP_NEXT"));
    });
  });
});

describe("Queue#previous()", () => {
  const distube = createFakeDisTube();
  test("No previous song", async () => {
    const queue = new Queue(distube as any, voice as any, anotherSong);
    await expect(queue.previous()).rejects.toThrow(new DisTubeError("NO_PREVIOUS"));
  });

  test("Play the previous song", async () => {
    const queue = new Queue(distube as any, voice as any, anotherSong);
    queue.previousSongs.push(song);
    await expect(queue.previous()).resolves.toBe(song);
    expect(queue.prev).toBe(true);
    expect(voice.stop).toBeCalledTimes(1);
  });

  test("Play the last song if repeat mode is all the queue", async () => {
    const queue = new Queue(distube as any, voice as any, anotherSong);
    queue.repeatMode = 2;
    await expect(queue.previous()).resolves.toBe(anotherSong);
    expect(queue.prev).toBe(true);
    expect(voice.stop).toBeCalledTimes(1);
  });

  test("savePreviousSongs is disabled", async () => {
    const queue = new Queue(distube as any, voice as any, anotherSong);
    distube.options.savePreviousSongs = false;
    await expect(queue.previous()).rejects.toThrow(new DisTubeError("DISABLED_OPTION", "savePreviousSongs"));
  });
});

describe("Queue#pause() & Queue#resume()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, song);

  test("Pause when playing", () => {
    expect(queue.pause()).toBe(queue);
    expect(queue.playing).toBe(false);
    expect(queue.paused).toBe(true);
    expect(voice.pause).toBeCalledTimes(1);
  });

  test("Pause when paused", () => {
    expect(() => {
      queue.pause();
    }).toThrow(new DisTubeError("PAUSED"));
  });

  test("Resume when paused", () => {
    expect(queue.resume()).toBe(queue);
    expect(queue.playing).toBe(true);
    expect(queue.paused).toBe(false);
    expect(voice.unpause).toBeCalledTimes(1);
  });

  test("Resume when playing", () => {
    expect(() => {
      queue.resume();
    }).toThrow(new DisTubeError("RESUMED"));
  });
});

describe("Queue#setFilter()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, song);
  const filter1 = "3d";
  const filter2 = "bassboost";
  const filter3 = "echo";
  const invalid1 = "invalid1";
  const invalid2 = "invalid2";

  test("Enable a filter", () => {
    expect(queue.setFilter(filter1)).toContain(filter1);
    expect(distube.queues.playSong).toBeCalledWith(queue);
  });

  test("Force enable a filter", () => {
    expect(queue.setFilter(filter1, true)).toContain(filter1);
    expect(distube.queues.playSong).toBeCalledWith(queue);
    expect(queue.setFilter(filter3, true)).toContain(filter3);
    expect(distube.queues.playSong).toBeCalledWith(queue);
    expect(distube.queues.playSong).toBeCalledTimes(2);
  });

  test("Enable a filter array", () => {
    const filter = [filter1, filter2, invalid1];
    queue.setFilter(filter);
    expect(queue.filters).not.toContain(filter1);
    expect(queue.filters).not.toContain(invalid1);
    expect(queue.filters).toContain(filter2);
    expect(queue.filters).toContain(filter3);
    expect(distube.queues.playSong).toBeCalledWith(queue);
  });

  test("Force enable a filter array", () => {
    const filter = [filter1, filter2, invalid2];
    queue.setFilter(filter, true);
    expect(queue.filters).not.toContain(invalid2);
    expect(queue.filters).toContain(filter1);
    expect(queue.filters).toContain(filter2);
    expect(queue.filters).toContain(filter3);
    expect(distube.queues.playSong).toBeCalledWith(queue);
  });

  test("Disable a filter", () => {
    expect(queue.setFilter(filter2)).not.toContain(filter2);
    expect(queue.filters).toContain(filter1);
    expect(queue.filters).toContain(filter3);
    expect(distube.queues.playSong).toBeCalledWith(queue);
  });

  test("Clear all filters", () => {
    expect(queue.setFilter(false).length).toBe(0);
    expect(distube.queues.playSong).toBeCalledWith(queue);
  });

  test("Enable an invalid filter", () => {
    const filter = "notAValidFilter";
    expect(() => {
      queue.setFilter(filter);
    }).toThrow(new DisTubeError("INVALID_TYPE", "filter name", filter, "filter"));
  });

  test("Enable an invalid filter array", () => {
    const filter = ["thisIs", "anInvalidFilter"];
    expect(() => {
      queue.setFilter(filter);
    }).toThrow(new DisTubeError("EMPTY_FILTERED_ARRAY", "filter", "filter name"));
  });
});

describe("Queue#seek()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, song);

  test("Seek to a valid position", () => {
    const position = 1;
    queue.seek(position);
    expect(queue.beginTime).toBe(position);
    expect(distube.queues.playSong).toBeCalledWith(queue);
  });

  test("Seek to a string", () => {
    const position: any = "string";
    expect(() => {
      queue.seek(position);
    }).toThrow(new DisTubeError("INVALID_TYPE", "number", position, "time"));
  });

  test("Seek to a NaN", () => {
    const position = NaN;
    expect(() => {
      queue.seek(position);
    }).toThrow(new DisTubeError("NUMBER_COMPARE", "time", "bigger or equal to", 0));
  });

  test("Seek to a negative number", () => {
    const position = -1;
    expect(() => {
      queue.seek(position);
    }).toThrow(new DisTubeError("NUMBER_COMPARE", "time", "bigger or equal to", 0));
  });
});

describe("Queue#setRepeatMode()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, song);

  test("Toggle mode", () => {
    expect(queue.repeatMode).toBe(0);
    expect(queue.setRepeatMode()).toBe(1);
    expect(queue.setRepeatMode()).toBe(2);
    expect(queue.setRepeatMode()).toBe(0);
  });

  test("Enable a repeat mode", () => {
    expect(queue.repeatMode).toBe(0);
    expect(queue.setRepeatMode(2)).toBe(2);
  });

  test("Disable a repeat mode", () => {
    expect(queue.repeatMode).toBe(2);
    expect(queue.setRepeatMode(2)).toBe(0);
  });

  test("Invalid mode", () => {
    expect(() => {
      queue.setRepeatMode("0" as any);
    }).toThrow(new DisTubeError("INVALID_TYPE", [0, 1, 2, "undefined"], "0", "mode"));
  });
});

test("Queue#delete()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, song);
  queue.delete();
  expect(queue.songs.length).toBe(0);
  expect(queue.previousSongs.length).toBe(0);
  expect(distube.queues.delete).toBeCalledWith(voice.id);
  expect(distube.emit).toBeCalledWith("deleteQueue", queue);
});

test("Queue#shuffle()", async () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, [0, 1, 2, 3] as any);
  await expect(queue.shuffle()).resolves.toBe(queue);
  expect(queue.songs.length).toBe(4);
  expect(queue.songs).toContain(0);
  expect(queue.songs).toContain(1);
  expect(queue.songs).toContain(2);
  expect(queue.songs).toContain(3);
  queue.songs = [];
  await expect(queue.shuffle()).resolves.toBe(queue);
  expect(queue.songs.length).toBe(0);
});

test("Queue#setVolume()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, song);
  expect(queue.setVolume(100)).toBe(queue);
  expect(queue.volume).toBe(100);
  expect(voice.volume).toBe(100);
  queue.volume = 1;
  expect(queue.volume).toBe(1);
  expect(voice.volume).toBe(1);
});

test("Queue#toggleAutoplay()", () => {
  const distube = createFakeDisTube();
  const queue = new Queue(distube as any, voice as any, song);
  expect(queue.autoplay).toBe(false);
  expect(queue.toggleAutoplay()).toBe(true);
  expect(queue.toggleAutoplay()).toBe(false);
});
