import { describe, expect, it, vi } from "vitest";
import { ErrorCode, Song, type SourcePlugin } from "../src";
import { createSourceCatalog, requireSongOwner, validateSourceSongs } from "../src/playback/sources";

function source(name: string): SourcePlugin {
  return {
    name,
    initialize: vi.fn(),
    dispose: vi.fn(),
    search: vi.fn(async () => []),
    resolve: vi.fn(async () => undefined),
    preparePlayback: vi.fn(async () => ({ kind: "search" as const, query: "query" })),
  };
}

function song(owner: string): Song {
  return new Song({
    id: `song-${owner}`,
    title: "Song",
    url: "https://provider.example/song",
    duration: 1,
    source: owner,
  });
}

describe("private source catalog", () => {
  it("resolves a directly enqueued Song by exact configured name", () => {
    const youtube = source("youtube");
    const catalog = createSourceCatalog([youtube]);
    const media = song("youtube");
    expect(requireSongOwner(media, catalog)).toBe(youtube);
    expect(Object.keys(media)).not.toContain("plugin");
  });

  it("rejects an unconfigured direct Song owner", () => {
    expect(() => requireSongOwner(song("spotify"), createSourceCatalog([source("youtube")]))).toThrowError(
      expect.objectContaining({ code: ErrorCode.SOURCE_FAILED }),
    );
  });

  it.each(["resolve", "search"] as const)("rejects %s results with mismatched provenance", operation => {
    const youtube = source("youtube");
    expect(() => validateSourceSongs([song("spotify")], youtube, operation)).toThrowError(
      expect.objectContaining({ code: ErrorCode.SOURCE_FAILED }),
    );
  });

  it("accepts an empty search result as a decline but rejects an empty resolve result", () => {
    const youtube = source("youtube");
    expect(validateSourceSongs([], youtube, "search", true)).toEqual([]);
    expect(() => validateSourceSongs([], youtube, "resolve")).toThrowError(
      expect.objectContaining({
        code: ErrorCode.SOURCE_FAILED,
        message: "youtube returned invalid media from resolve",
      }),
    );
  });

  it("rejects a non-Song entry mixed into an otherwise valid search result", () => {
    const youtube = source("youtube");
    expect(() =>
      validateSourceSongs([song("youtube"), { id: "fake" } as unknown as Song], youtube, "search", true),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.SOURCE_FAILED }));
  });

  it("preserves configured order without exposing mutable lookup storage", () => {
    const youtube = source("youtube");
    const soundcloud = source("soundcloud");
    const catalog = createSourceCatalog([youtube, soundcloud]);
    expect(catalog.ordered).toEqual([youtube, soundcloud]);
    expect(Object.isFrozen(catalog.ordered)).toBe(true);
    expect(Object.keys(catalog)).toEqual(["ordered", "get"]);
  });
});
