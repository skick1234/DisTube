import type { DisTube, Song } from "../src";
import type { Plugin, PluginDataOf } from "../src/integrations";

interface YouTubeData {
  readonly views: number;
}

interface SoundCloudData {
  readonly plays: number;
}

declare const distube: DisTube;
declare const youtube: Plugin<YouTubeData>;
declare const soundcloud: Plugin<SoundCloudData>;

// `source` narrows every result's pluginData to the plugin's declaration without a cast.
const typed: Promise<readonly Song<YouTubeData>[]> = distube.search("lofi", { source: youtube });
const views: Promise<number | undefined> = typed.then(songs => songs[0]?.pluginData.views);
const typedData: PluginDataOf<typeof youtube> = { views: 1 };

// Without `source`, results are plain Songs whose pluginData is unknown.
const untyped: Promise<readonly Song[]> = distube.search("lofi");
// @ts-expect-error unknown pluginData needs narrowing before a property read
untyped.then(songs => songs[0]?.pluginData.views);
// @ts-expect-error a YouTube song is not a SoundCloud song
const wrong: Promise<readonly Song<SoundCloudData>[]> = distube.search("lofi", { source: youtube });

// A union of plugin instances still compiles; the result is the plain Song list or the inferred union.
declare const either: typeof youtube | typeof soundcloud;
const union: Promise<readonly Song[]> = distube.search("lofi", { source: either });

// Suggestions are strings and accept an optional source and signal.
const suggestions: Promise<readonly string[]> = distube.suggest("lo", { source: youtube });
const fallback: Promise<readonly string[]> = distube.suggest("lo");
const signalled: Promise<readonly string[]> = distube.suggest("lo", { signal: new AbortController().signal });
// @ts-expect-error the source is an option, not a positional argument
distube.suggest("lo", youtube);
// @ts-expect-error suggestions are not Songs
const notSongs: Promise<readonly Song[]> = distube.suggest("lo");

// A plugin declares its data once and its Songs carry it.
const plugin: Plugin<YouTubeData> = {
  name: "youtube",
  async search(): Promise<readonly Song<YouTubeData>[]> {
    return [];
  },
  async resolve(): Promise<Song<YouTubeData> | undefined> {
    return undefined;
  },
  async stream(): Promise<never> {
    throw new Error("unused");
  },
};
const mismatched: Plugin<YouTubeData> = {
  ...plugin,
  // @ts-expect-error the declared data shape is enforced on returned Songs
  async search(): Promise<readonly Song<SoundCloudData>[]> {
    return [];
  },
};

void [typed, views, typedData, untyped, wrong, union, suggestions, fallback, signalled, notSongs, plugin, mismatched];
