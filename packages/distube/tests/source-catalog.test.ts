import { describe, expect, it, vi } from "vitest";
import { Playlist, Song } from "../src";
import type { SourcePlugin } from "../src/integrations";
import { relatedSong } from "../src/playback/related";
import { resolveInput } from "../src/playback/resolve";
import {
  createSourceCatalog,
  requireSongOwner,
  validateResolvedMedia,
  validateSourceSongs,
} from "../src/playback/sources";

function source(name: string): SourcePlugin {
  return {
    name,
    initialize: vi.fn(),
    dispose: vi.fn(),
    search: vi.fn(async () => []),
    resolve: vi.fn(async () => undefined),
    stream: vi.fn(async () => ({ kind: "search" as const, query: "query" })),
  };
}

function song(owner: string): Song {
  return new Song({
    id: `song-${owner}`,
    name: "Song",
    url: "https://provider.example/song",
    duration: 1,
    source: owner,
  });
}

describe("private source catalog", () => {
  it("rejects an unconfigured direct Song owner", () => {
    expect(() => requireSongOwner(song("spotify"), createSourceCatalog([source("youtube")]))).toThrowError(
      expect.objectContaining({ code: "SOURCE_FAILED" }),
    );
  });

  it("requires a direct Playlist and its Songs to share one configured owner", async () => {
    const catalog = createSourceCatalog([source("youtube"), source("soundcloud")]);
    const playlist = (owner: string, entry: Song) =>
      new Playlist({ id: "list", name: "List", url: "https://provider.example/list", source: owner, songs: [entry] });
    const signal = new AbortController().signal;
    const valid = playlist("youtube", song("youtube"));

    await expect(resolveInput(valid, catalog, signal)).resolves.toBe(valid);
    await expect(resolveInput(playlist("spotify", song("youtube")), catalog, signal)).rejects.toMatchObject({
      code: "SOURCE_FAILED",
    });
    await expect(resolveInput(playlist("youtube", song("soundcloud")), catalog, signal)).rejects.toMatchObject({
      code: "SOURCE_FAILED",
    });
  });

  it("accepts owned resolve media and rejects foreign playlist ownership or entries", () => {
    const youtube = source("youtube");
    const media = song("youtube");
    expect(validateResolvedMedia(media, youtube)).toBe(media);
    const playlist = (owner: string, entry: Song) =>
      new Playlist({ id: "list", name: "List", url: "https://provider.example/list", source: owner, songs: [entry] });
    const valid = playlist("youtube", media);
    expect(validateResolvedMedia(valid, youtube)).toBe(valid);
    for (const invalid of [playlist("foreign", media), playlist("youtube", song("foreign"))]) {
      expect(() => validateResolvedMedia(invalid, youtube)).toThrowError(
        expect.objectContaining({ code: "SOURCE_FAILED" }),
      );
    }
    expect(() => validateSourceSongs(valid, youtube, "search")).toThrowError(
      expect.objectContaining({ code: "SOURCE_FAILED" }),
    );
  });

  it.each([null, false, 0, [], {}, song("foreign")])("rejects malformed related output %j", async value => {
    const owner: SourcePlugin = { ...source("youtube"), related: async () => value as unknown as Song };
    await expect(
      relatedSong(song("youtube"), createSourceCatalog([owner]), new AbortController().signal, []),
    ).rejects.toMatchObject({ code: "SOURCE_FAILED" });
  });

  it("treats only undefined or an absent related method as a decline", async () => {
    const owner = source("youtube");
    const catalog = createSourceCatalog([owner]);
    await expect(relatedSong(song("youtube"), catalog, new AbortController().signal, [])).resolves.toBeUndefined();
    const declines = { ...owner, related: async () => undefined };
    await expect(
      relatedSong(song("youtube"), createSourceCatalog([declines]), new AbortController().signal, []),
    ).resolves.toBeUndefined();
  });
});
