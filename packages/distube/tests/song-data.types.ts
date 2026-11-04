import { Playlist, type PlaylistData, type Plugin, Song, type SongData, type Thumbnail } from "distube";
import { expectTypeOf } from "vitest";

const identity = { source: "source", id: "song", name: "Song", url: "https://example.test/song" };
const data = { providerId: "id" };
const inferred = new Song({ ...identity, pluginData: data });
expectTypeOf(inferred.pluginData).toEqualTypeOf<{ providerId: string }>();
new Song<{ providerId: string }>({ ...identity, pluginData: data });
// @ts-expect-error Concrete provider data cannot be omitted.
new Song<{ providerId: string }>(identity);
// @ts-expect-error The data contract also requires concrete provider data.
const missing: SongData<{ providerId: string }> = identity;
void missing;
const optional = new Song<{ providerId: string } | undefined>(identity);
expectTypeOf(optional.pluginData).toEqualTypeOf<{ providerId: string } | undefined>();
expectTypeOf(new Song(identity).pluginData).toEqualTypeOf<unknown>();
const art: readonly Thumbnail[] = [{ url: "https://example.test/art.jpg", width: 100, height: 100 }, { url: "x" }];
expectTypeOf(new Song({ ...identity, thumbnails: art }).thumbnail).toEqualTypeOf<string | undefined>();
// @ts-expect-error Plugins list thumbnails; the single thumbnail is derived.
new Song({ ...identity, thumbnail: "https://example.test/art.jpg" });

const song = new Song({ ...identity, pluginData: data });
const list = { source: "source", id: "list", name: "List", url: "https://example.test/list", songs: [song] };
const listData = { owner: "uploader" };
const typedList = new Playlist({ ...list, pluginData: listData });
expectTypeOf(typedList.pluginData).toEqualTypeOf<{ owner: string }>();
expectTypeOf(typedList.songs).toEqualTypeOf<readonly Song<{ providerId: string }>[]>();
// @ts-expect-error Concrete playlist data cannot be omitted.
new Playlist<{ providerId: string }, { owner: string }>(list);
// @ts-expect-error The playlist data contract also requires concrete playlist data.
const missingList: PlaylistData<{ providerId: string }, { owner: string }> = list;
void missingList;
expectTypeOf(new Playlist(list).pluginData).toEqualTypeOf<unknown>();

declare const plugin: Plugin<{ providerId: string }, { owner: string }>;
const resolved = await plugin.resolve?.("https://example.test/list", {
  signal: AbortSignal.timeout(1),
  maxPlaylistSongs: 500,
});
if (resolved instanceof Playlist) expectTypeOf(resolved.pluginData).toEqualTypeOf<{ owner: string }>();
