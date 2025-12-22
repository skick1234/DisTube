import { describe, expect, it, vi } from "vitest";
import { DisTube, Events, Playlist, type Song } from "@";

vi.mock("@/core/DisTubeHandler");
vi.mock("@/core/manager/QueueManager");
vi.mock("@/core/manager/DisTubeVoiceManager");

// Mock the util module to bypass Client and intents checks
vi.mock("@/util", async importOriginal => {
  const original = (await importOriginal()) as object;
  return {
    ...original,
    isClientInstance: vi.fn().mockReturnValue(true),
    checkIntents: vi.fn(),
    isSupportedVoiceChannel: vi.fn().mockReturnValue(true),
    isMessageInstance: vi.fn().mockReturnValue(true),
    isTextChannelInstance: vi.fn().mockReturnValue(true),
    isMemberInstance: vi.fn().mockReturnValue(true),
    isNsfwChannel: vi.fn().mockReturnValue(false),
  };
});

describe("DisTube", () => {
  const createMockClient = () =>
    ({
      options: {
        intents: {
          has: vi.fn().mockReturnValue(true),
        },
      },
      user: { id: "bot-user-id" },
      login: vi.fn(), // Required for isClientInstance check
    }) as any;

  const createMockVoiceChannel = () =>
    ({
      id: "voice-channel-id",
      type: 2, // GuildVoice
      guild: {
        id: "guild-id",
        members: { me: { id: "bot-member-id" } },
        voiceAdapterCreator: vi.fn(),
      },
      joinable: true,
      full: false,
      bitrate: 64000,
    }) as any;

  const createMockQueue = (overrides = {}) =>
    ({
      id: "guild-id",
      songs: [],
      playing: false,
      paused: false,
      stopped: false,
      _taskQueue: {
        queuing: vi.fn().mockResolvedValue(undefined),
        resolve: vi.fn(),
        hasPlayTask: false,
      },
      addToQueue: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      skip: vi.fn().mockResolvedValue({ id: "next-song" }),
      remove: vi.fn(),
      ...overrides,
    }) as any;

  const createMockSong = (overrides = {}) =>
    ({
      id: "song-id",
      name: "Test Song",
      url: "https://example.com/song",
      ageRestricted: false,
      stream: {},
      ...overrides,
    }) as Song;

  const createMockPlaylist = (songs: Song[], overrides = {}) =>
    Object.assign(Object.create(Playlist.prototype), {
      id: "playlist-id",
      name: "Test Playlist",
      url: "https://example.com/playlist",
      songs,
      ...overrides,
    }) as Playlist;

  describe("play()", () => {
    describe("first song behavior (new queue)", () => {
      it("calls queue.play() when queue is empty (first song)", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddSongWhenCreatingQueue: true,
        });
        const voiceChannel = createMockVoiceChannel();
        const queue = createMockQueue({ songs: [] }); // Empty queue
        const song = createMockSong();

        // Mock handler.resolve
        distube.handler.resolve = vi.fn().mockResolvedValue(song);
        // Mock getQueue to return undefined (no existing queue), then the created queue
        distube.queues.get = vi.fn().mockReturnValue(undefined);
        distube.queues.create = vi.fn().mockResolvedValue(queue);

        // Track that addToQueue adds to the songs array
        queue.addToQueue.mockImplementation(() => {
          queue.songs.push(song);
        });

        await distube.play(voiceChannel, "test song");

        expect(queue.play).toHaveBeenCalled();
        expect(queue.skip).not.toHaveBeenCalled();
      });

      it("does NOT call queue.play() when queue already has songs", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddSongWhenCreatingQueue: true,
        });
        const voiceChannel = createMockVoiceChannel();
        const existingSong = createMockSong({ id: "existing-song" });
        const queue = createMockQueue({
          songs: [existingSong], // Queue already has a song
        });
        const newSong = createMockSong({ id: "new-song" });

        distube.handler.resolve = vi.fn().mockResolvedValue(newSong);
        distube.queues.get = vi.fn().mockReturnValue(queue);

        queue.addToQueue.mockImplementation(() => {
          queue.songs.push(newSong);
        });

        await distube.play(voiceChannel, "another song");

        expect(queue.play).not.toHaveBeenCalled();
        expect(queue.skip).not.toHaveBeenCalled();
      });

      it("calls queue.skip() when skip option is true and queue has songs", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, { plugins: [] });
        const voiceChannel = createMockVoiceChannel();
        const existingSong = createMockSong({ id: "existing-song" });
        const queue = createMockQueue({
          songs: [existingSong],
        });
        const newSong = createMockSong({ id: "new-song" });

        distube.handler.resolve = vi.fn().mockResolvedValue(newSong);
        distube.queues.get = vi.fn().mockReturnValue(queue);

        queue.addToQueue.mockImplementation(() => {
          queue.songs.splice(1, 0, newSong); // Insert at position 1
        });

        await distube.play(voiceChannel, "skip to this", { skip: true });

        expect(queue.play).not.toHaveBeenCalled();
        expect(queue.skip).toHaveBeenCalled();
      });
    });

    describe("emitAddSongWhenCreatingQueue option", () => {
      it("emits ADD_SONG when queue already has songs (regardless of option)", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddSongWhenCreatingQueue: false, // Option is false
        });
        const voiceChannel = createMockVoiceChannel();
        const existingSong = createMockSong({ id: "existing-song" });
        const queue = createMockQueue({
          songs: [existingSong], // Queue already has songs
        });
        const newSong = createMockSong({ id: "new-song" });

        distube.handler.resolve = vi.fn().mockResolvedValue(newSong);
        distube.queues.get = vi.fn().mockReturnValue(queue);

        const emitSpy = vi.spyOn(distube, "emit");

        queue.addToQueue.mockImplementation(() => {
          queue.songs.push(newSong);
        });

        await distube.play(voiceChannel, "test song");

        expect(emitSpy).toHaveBeenCalledWith(Events.ADD_SONG, queue, newSong);
      });

      it("emits ADD_SONG when emitAddSongWhenCreatingQueue is true (new queue)", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddSongWhenCreatingQueue: true,
        });
        const voiceChannel = createMockVoiceChannel();
        const queue = createMockQueue({ songs: [] }); // Empty queue
        const song = createMockSong();

        distube.handler.resolve = vi.fn().mockResolvedValue(song);
        distube.queues.get = vi.fn().mockReturnValue(undefined);
        distube.queues.create = vi.fn().mockResolvedValue(queue);

        const emitSpy = vi.spyOn(distube, "emit");

        queue.addToQueue.mockImplementation(() => {
          queue.songs.push(song);
        });

        await distube.play(voiceChannel, "test song");

        expect(emitSpy).toHaveBeenCalledWith(Events.ADD_SONG, queue, song);
      });

      it("does NOT emit ADD_SONG when emitAddSongWhenCreatingQueue is false (new queue)", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddSongWhenCreatingQueue: false,
        });
        const voiceChannel = createMockVoiceChannel();
        const queue = createMockQueue({ songs: [] }); // Empty queue
        const song = createMockSong();

        distube.handler.resolve = vi.fn().mockResolvedValue(song);
        distube.queues.get = vi.fn().mockReturnValue(undefined);
        distube.queues.create = vi.fn().mockResolvedValue(queue);

        const emitSpy = vi.spyOn(distube, "emit");

        queue.addToQueue.mockImplementation(() => {
          queue.songs.push(song);
        });

        await distube.play(voiceChannel, "test song");

        expect(emitSpy).not.toHaveBeenCalledWith(Events.ADD_SONG, queue, song);
      });
    });

    describe("emitAddListWhenCreatingQueue option", () => {
      it("emits ADD_LIST when queue already has songs (regardless of option)", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddListWhenCreatingQueue: false,
        });
        const voiceChannel = createMockVoiceChannel();
        const existingSong = createMockSong({ id: "existing-song" });
        const queue = createMockQueue({
          songs: [existingSong], // Queue already has songs
        });
        const songs = [createMockSong({ id: "song-1" }), createMockSong({ id: "song-2" })];
        const playlist = createMockPlaylist(songs);

        distube.handler.resolve = vi.fn().mockResolvedValue(playlist);
        distube.queues.get = vi.fn().mockReturnValue(queue);

        const emitSpy = vi.spyOn(distube, "emit");

        queue.addToQueue.mockImplementation((songsToAdd: Song[]) => {
          queue.songs.push(...songsToAdd);
        });

        await distube.play(voiceChannel, "test playlist");

        expect(emitSpy).toHaveBeenCalledWith(Events.ADD_LIST, queue, playlist);
      });

      it("emits ADD_LIST when emitAddListWhenCreatingQueue is true (new queue)", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddListWhenCreatingQueue: true,
        });
        const voiceChannel = createMockVoiceChannel();
        const queue = createMockQueue({ songs: [] }); // Empty queue
        const songs = [createMockSong({ id: "song-1" }), createMockSong({ id: "song-2" })];
        const playlist = createMockPlaylist(songs);

        distube.handler.resolve = vi.fn().mockResolvedValue(playlist);
        distube.queues.get = vi.fn().mockReturnValue(undefined);
        distube.queues.create = vi.fn().mockResolvedValue(queue);

        const emitSpy = vi.spyOn(distube, "emit");

        queue.addToQueue.mockImplementation((songsToAdd: Song[]) => {
          queue.songs.push(...songsToAdd);
        });

        await distube.play(voiceChannel, "test playlist");

        expect(emitSpy).toHaveBeenCalledWith(Events.ADD_LIST, queue, playlist);
      });

      it("does NOT emit ADD_LIST when emitAddListWhenCreatingQueue is false (new queue)", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddListWhenCreatingQueue: false,
        });
        const voiceChannel = createMockVoiceChannel();
        const queue = createMockQueue({ songs: [] }); // Empty queue
        const songs = [createMockSong({ id: "song-1" }), createMockSong({ id: "song-2" })];
        const playlist = createMockPlaylist(songs);

        distube.handler.resolve = vi.fn().mockResolvedValue(playlist);
        distube.queues.get = vi.fn().mockReturnValue(undefined);
        distube.queues.create = vi.fn().mockResolvedValue(queue);

        const emitSpy = vi.spyOn(distube, "emit");

        queue.addToQueue.mockImplementation((songsToAdd: Song[]) => {
          queue.songs.push(...songsToAdd);
        });

        await distube.play(voiceChannel, "test playlist");

        expect(emitSpy).not.toHaveBeenCalledWith(Events.ADD_LIST, queue, playlist);
      });
    });

    describe("isFirstSong detection accuracy", () => {
      it("detects first song correctly based on queue.songs.length BEFORE addToQueue", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddSongWhenCreatingQueue: true,
        });
        const voiceChannel = createMockVoiceChannel();
        const queue = createMockQueue({ songs: [] }); // Empty queue
        const song = createMockSong();

        distube.handler.resolve = vi.fn().mockResolvedValue(song);
        distube.queues.get = vi.fn().mockReturnValue(undefined);
        distube.queues.create = vi.fn().mockResolvedValue(queue);

        // Simulate that addToQueue adds songs - isFirstSong was captured before
        queue.addToQueue.mockImplementation(() => {
          queue.songs.push(song);
        });

        await distube.play(voiceChannel, "test song");

        // queue.play() should still be called because isFirstSong was determined before addToQueue
        expect(queue.play).toHaveBeenCalled();
      });

      it("correctly identifies non-first song when queue already has songs", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, {
          plugins: [],
          emitAddSongWhenCreatingQueue: false,
        });
        const voiceChannel = createMockVoiceChannel();
        const existingSong = createMockSong({ id: "existing" });
        const queue = createMockQueue({
          songs: [existingSong], // Queue already has songs
        });
        const newSong = createMockSong({ id: "new" });

        distube.handler.resolve = vi.fn().mockResolvedValue(newSong);
        distube.queues.get = vi.fn().mockReturnValue(queue);

        const emitSpy = vi.spyOn(distube, "emit");

        queue.addToQueue.mockImplementation(() => {
          queue.songs.push(newSong);
        });

        await distube.play(voiceChannel, "test song");

        // Should emit ADD_SONG because it's not first song (queue already had songs)
        expect(emitSpy).toHaveBeenCalledWith(Events.ADD_SONG, queue, newSong);
        // Should NOT call play because queue already has songs
        expect(queue.play).not.toHaveBeenCalled();
      });
    });

    describe("position and skip integration", () => {
      it("inserts song at position 1 when skip is true", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, { plugins: [] });
        const voiceChannel = createMockVoiceChannel();
        const existingSong = createMockSong({ id: "existing" });
        const queue = createMockQueue({
          songs: [existingSong],
        });
        const newSong = createMockSong({ id: "new" });

        distube.handler.resolve = vi.fn().mockResolvedValue(newSong);
        distube.queues.get = vi.fn().mockReturnValue(queue);

        let insertPosition: number | undefined;
        queue.addToQueue.mockImplementation((_song: Song, pos: number) => {
          insertPosition = pos;
          queue.songs.splice(pos, 0, newSong);
        });

        await distube.play(voiceChannel, "skip to me", { skip: true });

        expect(insertPosition).toBe(1);
        expect(queue.skip).toHaveBeenCalled();
      });

      it("inserts song at end (position 0) when skip is false", async () => {
        const client = createMockClient();
        const distube = new DisTube(client, { plugins: [] });
        const voiceChannel = createMockVoiceChannel();
        const existingSong = createMockSong({ id: "existing" });
        const queue = createMockQueue({
          songs: [existingSong],
        });
        const newSong = createMockSong({ id: "new" });

        distube.handler.resolve = vi.fn().mockResolvedValue(newSong);
        distube.queues.get = vi.fn().mockReturnValue(queue);

        let insertPosition: number | undefined;
        queue.addToQueue.mockImplementation((_song: Song, pos: number) => {
          insertPosition = pos;
          if (pos <= 0) {
            queue.songs.push(newSong);
          } else {
            queue.songs.splice(pos, 0, newSong);
          }
        });

        await distube.play(voiceChannel, "add to end", { skip: false });

        expect(insertPosition).toBe(0);
        expect(queue.skip).not.toHaveBeenCalled();
      });
    });
  });
});
