import { Song, type SongData } from "distube";
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
