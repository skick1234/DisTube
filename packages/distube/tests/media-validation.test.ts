import { describe, expect, it } from "vitest";
import { type DisTubeError, ErrorCode, Playlist, QueueItem, Song, type SongData } from "../src";

const valid: SongData = {
  id: "song",
  title: "Song",
  url: "https://provider.example/song",
  duration: 60,
  source: "provider",
};

describe("media value validation", () => {
  it.each([
    ["id", "", "Song id must be a non-empty string"],
    ["title", "", "Song title must be a non-empty string"],
    ["url", "", "Song url must be a non-empty string"],
    ["duration", -1, "Song duration must be a non-negative number"],
    ["duration", Number.NaN, "Song duration must be a non-negative number"],
    ["source", "", "Song source must be a non-empty string"],
  ] as const)("rejects invalid %s", (key, value, message) => {
    expect(() => new Song({ ...valid, [key]: value })).toThrowError(
      expect.objectContaining<Partial<DisTubeError>>({ code: ErrorCode.INVALID_ARGUMENT, message }),
    );
  });

  it("rejects a non-Song QueueItem owner", () => {
    expect(() => new QueueItem({ song: {} as Song })).toThrowError(
      expect.objectContaining<Partial<DisTubeError>>({
        code: ErrorCode.INVALID_ARGUMENT,
        message: "QueueItem song must be a Song",
      }),
    );
  });

  it("exposes optional display fields and reads absent ones as undefined", () => {
    const song = new Song({
      ...valid,
      thumbnail: "https://provider.example/art.jpg",
      uploader: { name: "Channel", url: "https://provider.example/channel" },
      isLive: true,
      views: 42,
    });
    expect(song).toMatchObject({ thumbnail: "https://provider.example/art.jpg", isLive: true, views: 42 });
    expect(song.uploader).toEqual({ name: "Channel", url: "https://provider.example/channel" });
    expect(new Song({ ...valid, uploader: { name: "Channel" } }).uploader).toEqual({ name: "Channel" });
    expect(new Song(valid)).toMatchObject({ thumbnail: undefined, uploader: undefined, views: undefined });
  });

  it.each([
    ["thumbnail", "", "Song thumbnail must be a non-empty string"],
    ["uploader", null, "Song uploader must be an object"],
    ["uploader", { name: "" }, "Song uploader name must be a non-empty string"],
    ["uploader", { name: "Channel", url: "" }, "Song uploader url must be a non-empty string"],
    ["isLive", "yes", "Song isLive must be a boolean"],
    ["views", -1, "Song views must be a non-negative number"],
  ] as const)("rejects invalid display field %s", (key, value, message) => {
    expect(() => new Song({ ...valid, [key]: value })).toThrowError(
      expect.objectContaining<Partial<DisTubeError>>({ code: ErrorCode.INVALID_ARGUMENT, message }),
    );
  });

  it("keeps a Playlist ordered and immutable", () => {
    const first = new Song({ ...valid, id: "a" });
    const second = new Song({ ...valid, id: "b" });
    const metadata = { nested: { value: 1 } };
    const songs = [first, second];
    const playlist = new Playlist({
      id: "list",
      name: "List",
      url: "https://provider.example/list",
      source: "provider",
      songs,
      metadata,
    });
    songs.push(first);
    metadata.nested.value = 2;

    expect(playlist.songs).toEqual([first, second]);
    expect(() => (playlist.songs as Song[]).push(second)).toThrowError();
    expect(playlist.metadata).toEqual({ nested: { value: 1 } });
  });

  it("rejects malformed Playlist data and accepts an optional thumbnail", () => {
    expect(() => new Playlist(null as never)).toThrowError(
      expect.objectContaining<Partial<DisTubeError>>({
        code: ErrorCode.INVALID_ARGUMENT,
        message: "Playlist data must be an object",
      }),
    );

    const data = { id: "list", name: "List", url: "https://provider.example/list", source: "provider" };
    for (const songs of [[], [{} as Song]]) {
      expect(() => new Playlist({ ...data, songs })).toThrowError(
        expect.objectContaining<Partial<DisTubeError>>({
          code: ErrorCode.INVALID_ARGUMENT,
          message: "Playlist songs must be a non-empty list of Songs",
        }),
      );
    }

    expect(() => new Playlist({ ...data, songs: [new Song(valid)], thumbnail: "" })).toThrowError(
      expect.objectContaining<Partial<DisTubeError>>({
        code: ErrorCode.INVALID_ARGUMENT,
        message: "Playlist thumbnail must be a non-empty string",
      }),
    );
    expect(new Playlist({ ...data, songs: [new Song(valid)], thumbnail: "cover.jpg" }).thumbnail).toBe("cover.jpg");
  });

  it("returns defensive Song metadata and date values", () => {
    const songMetadata = { nested: { value: 1 } };
    const song = new Song({ ...valid, metadata: songMetadata });
    const item = new QueueItem({ song });
    songMetadata.nested.value = 2;

    expect(song.metadata).toEqual({ nested: { value: 1 } });
    const first = item.addedAt;
    first.setFullYear(2000);
    expect(item.addedAt.getFullYear()).not.toBe(2000);
  });

  it("keeps QueueItem metadata caller-owned while identity stays immutable", () => {
    const song = new Song(valid);
    const requester = { id: "user" };
    const item = new QueueItem({ song, metadata: requester });
    requester.id = "changed";
    expect(item.metadata).toBe(requester);

    item.metadata = "replaced";
    expect(item.metadata).toBe("replaced");
    expect(new QueueItem({ song }).metadata).toBeUndefined();
    expect(() => {
      (item as { id: string }).id = "forged";
    }).toThrowError();
    expect(item.song).toBe(song);
  });
});
