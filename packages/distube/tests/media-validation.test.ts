import { describe, expect, it } from "vitest";
import { type DisTubeError, Playlist, Song, type SongData } from "../src";
import { QueueItem } from "../src/media";

const valid: SongData = {
  id: "song",
  name: "Song",
  url: "https://provider.example/song",
  duration: 60,
  source: "provider",
};

describe("media value validation", () => {
  it.each([
    ["id", "", "Song id must be a non-empty string"],
    ["name", "", "Song name must be a non-empty string"],
    ["url", "", "Song url must be a non-empty string"],
    ["duration", -1, "Song duration must be a non-negative number"],
    ["duration", Number.NaN, "Song duration must be a non-negative number"],
    ["source", "", "Song source must be a non-empty string"],
  ] as const)("rejects invalid %s", (key, value, message) => {
    expect(() => new Song({ ...valid, [key]: value })).toThrowError(
      expect.objectContaining<Partial<DisTubeError>>({ code: "INVALID_ARGUMENT", message }),
    );
  });

  it("accepts optional duration and display fields", () => {
    const { duration: _, ...withoutDuration } = valid;
    expect(new Song(withoutDuration).duration).toBeUndefined();
    const song = new Song({ ...valid, thumbnail: "cover.jpg", artist: "Artist" });
    expect(song).toMatchObject({ thumbnail: "cover.jpg", artist: "Artist", duration: 60 });
    expect(Object.isFrozen(song)).toBe(true);
  });

  it.each(["thumbnail", "artist"] as const)("rejects an empty %s", key => {
    expect(() => new Song({ ...valid, [key]: "" })).toThrowError(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });

  it("keeps a Playlist ordered and immutable", () => {
    const first = new Song({ ...valid, id: "a" });
    const second = new Song({ ...valid, id: "b" });
    const songs = [first, second];
    const playlist = new Playlist({
      id: "list",
      name: "List",
      url: "https://provider.example/list",
      source: "provider",
      songs,
    });
    songs.push(first);

    expect(playlist.songs).toEqual([first, second]);
    expect(() => (playlist.songs as Song[]).push(second)).toThrowError();
  });

  it("rejects malformed Playlist data and accepts an optional thumbnail", () => {
    expect(() => new Playlist(null as never)).toThrowError(
      expect.objectContaining<Partial<DisTubeError>>({
        code: "INVALID_ARGUMENT",
        message: "Playlist data must be an object",
      }),
    );

    const data = { id: "list", name: "List", url: "https://provider.example/list", source: "provider" };
    for (const songs of [[], [{} as Song]]) {
      expect(() => new Playlist({ ...data, songs })).toThrowError(
        expect.objectContaining<Partial<DisTubeError>>({
          code: "INVALID_ARGUMENT",
          message: "Playlist songs must be a non-empty list of Songs",
        }),
      );
    }

    expect(() => new Playlist({ ...data, songs: [new Song(valid)], thumbnail: "" })).toThrowError(
      expect.objectContaining<Partial<DisTubeError>>({
        code: "INVALID_ARGUMENT",
        message: "Playlist thumbnail must be a non-empty string",
      }),
    );
    expect(new Playlist({ ...data, songs: [new Song(valid)], thumbnail: "cover.jpg" }).thumbnail).toBe("cover.jpg");
  });

  it("stores provider-owned pluginData by reference without cloning or freezing it", () => {
    const data = { views: 1 };
    expect(new Song({ ...valid, pluginData: data }).pluginData).toBe(data);
    expect(Object.isFrozen(data)).toBe(false);
    expect(new Song(valid).pluginData).toBeUndefined();
  });

  it("formats Song durations as m:ss or h:mm:ss, and Live without a duration", () => {
    expect(new Song({ ...valid, duration: 245 }).formattedDuration).toBe("4:05");
    expect(new Song({ ...valid, duration: 3665 }).formattedDuration).toBe("1:01:05");
    expect(new Song({ ...valid, duration: 0 }).formattedDuration).toBe("Live");
    const { duration: _, ...withoutDuration } = valid;
    expect(new Song(withoutDuration).formattedDuration).toBe("Live");
  });

  it("sums Playlist durations, treating an unknown duration as 0, and keeps its own pluginData", () => {
    const { duration: _, ...withoutDuration } = valid;
    const pluginData = { channel: "owner" };
    const playlist = new Playlist({
      id: "list",
      name: "List",
      url: "https://provider.example/list",
      source: "provider",
      songs: [
        new Song({ ...valid, id: "a", duration: 3600 }),
        new Song({ ...valid, id: "b", duration: 65 }),
        new Song({ ...withoutDuration, id: "c" }),
      ],
      pluginData,
    });
    expect(playlist.duration).toBe(3665);
    expect(playlist.formattedDuration).toBe("1:01:05");
    expect(playlist.pluginData).toBe(pluginData);
    expect(new Playlist({ ...playlist, songs: playlist.songs }).pluginData).toBe(pluginData);
  });

  it("keeps occurrence dates defensive and generates a new identity each time", () => {
    const song = new Song(valid);
    const item = new QueueItem({ song });
    const first = item.addedAt;
    first.setFullYear(2000);
    expect(item.addedAt.getFullYear()).not.toBe(2000);
    expect(new QueueItem({ song }).id).not.toBe(item.id);
  });

  it("keeps QueueItem metadata caller-owned while identity stays immutable", () => {
    const song = new Song(valid);
    const requester = { id: "user" };
    // Untyped: the metadata parameter defaults to `unknown`, so the slot takes anything.
    const item = new QueueItem({ song, metadata: requester as unknown });
    requester.id = "changed";
    expect(item.metadata).toBe(requester);

    expect(() => {
      // @ts-expect-error The binding is readonly; the caller still owns the object.
      item.metadata = "replaced";
    }).toThrowError();
    expect(item.metadata).toBe(requester);
    expect(Object.isFrozen(requester)).toBe(false);
    expect(new QueueItem({ song }).metadata).toBeUndefined();
    expect(() => {
      (item as { id: string }).id = "forged";
    }).toThrowError();
    expect(item.song).toBe(song);
  });
});
