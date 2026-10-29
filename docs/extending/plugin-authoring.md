---
title: Plugin authoring
description: Write a Plugin with typed pluginData and core error codes.
sidebar:
  order: 1
---

A `Plugin` has a non-empty `name` and at least one of `resolve`, `search`, `stream` or `engine`. `related`,
`suggest` and `dispose` are independently optional. A plugin with only `stream` is valid. It plays Songs the
application builds itself, such as [sound clips](../../recipes/soundboard/). A plugin that returns Songs and has no `stream` plays through the [search fallback](#a-plugin-without-stream), or through an engine
plugin's `prepare`. There is no `initialize` hook: constructors validate options only, and the first
provider request happens on first use. Do not add no-op methods for missing capabilities.

Declare `Plugin<Data, ListData>` to type the `pluginData` of every Song and Playlist. Give a Playlist the same two
type arguments, `new Playlist<Data, ListData>({ ..., pluginData })`, and `resolve` returns
`Song<Data> | Playlist<Data, ListData> | undefined`. A concrete `ListData` makes the Playlist's `pluginData`
required at construction. Omit it and Playlist data stays `unknown`. Return `Song` and `Playlist` values from `distube`.
Each one must have `source` equal to the plugin's `name`. `resolve` returns a Song, an ordered Playlist or
`undefined` to decline. Throw for a provider failure.

Core decides which method a string reaches, as described in [plugins and their order](../../get-started/how-distube-works/#plugins-and-their-order). Accept your own URI scheme, such as `spotify:track:...`, in `search` if you want to serve it.

```ts
import { Song } from "distube";
import type { PlaybackResource, Plugin } from "distube/integrations";

interface ExampleData {
  readonly plays: number;
}

export class ExampleSource implements Plugin<ExampleData> {
  readonly name = "example";

  async resolve(url: string): Promise<Song<ExampleData> | undefined> {
    if (url !== "https://example.audio/track/1") return undefined;
    return new Song({
      source: this.name,
      id: "1",
      name: "Example track",
      url,
      pluginData: { plays: 9 },
    });
  }

  async stream(_song: Song<ExampleData>, options: { readonly signal: AbortSignal }): Promise<PlaybackResource> {
    options.signal.throwIfAborted();
    return { kind: "url", url: "https://cdn.example/audio.mp3" };
  }
}
```

A real provider reacquires its playback URL inside `stream` on every call. For a search-only catalog, implement
`search` and omit `resolve`. An explicit `distube.search(q, { source })` on a plugin without `search` rejects
`UNSUPPORTED`.

`search(query, { signal, limit, offset })` receives a positive integer `limit` and a zero-based `offset`. Clamp
`limit` to your own maximum and document it in the package README. Return results in the provider's ranking.
Core never re-ranks across plugins. An empty array declines the query.

## How core uses each method

| Operation                          | Plugin declines                  | Plugin throws                           |
| ---------------------------------- | -------------------------------- | --------------------------------------- |
| URL given to `resolve`             | `undefined`: try the next plugin | Rejects                                 |
| Query for `play`, `add`, `resolve` | `[]`: try the next plugin        | Recorded, then the next plugin is tried |
| `distube.search`                   | `[]`: try the next plugin        | Rejects                                 |
| `distube.suggest`                  | `[]`: try the next plugin        | Rejects                                 |

The outcomes when every plugin declines or fails are in [plugins and their order](../../get-started/how-distube-works/#plugins-and-their-order).

## Preparing a Song

`stream(song, { signal })` runs when a Song is about to play. Core calls the plugin named by `song.source`, and
that plugin returns a `PlaybackResource`: a fresh, single-use `url`, `file`, `stream`, `reader`, `timed` or `encoded`
resource. See [playback resources](../playback-resources/) for the shapes and cleanup rules. A `stream` that throws
fails the item with `queue.item.failed`, and core tries no other plugin.

Add an `engine` when the plugin plays media itself, as Lavalink does. See
[adapter authoring](../adapter-authoring/#engine-plugins) for `onClosed`, pause and release rules. Its `engine.prepare(song, { signal })` replaces
`stream` for every Song, and core calls no plugin's `stream`.

## A plugin without stream

Omit `stream` when the provider serves metadata only, as Spotify does. Core then plays the Song through a search
fallback:

1. It builds the query from `song.name`, followed by `song.artist` when present.
2. It searches every other plugin that has both `search` and `stream`, in the order of `plugins`, with limit 1.
3. It prepares only the first candidate of each plugin through that plugin's `stream`, and stops at the first resource.

If nothing is found, the item fails `NO_RESULT`. If a search or stream failed, it fails `SOURCE_FAILED` with an
`AggregateError` of every failure. Queue state and events keep the original item and Song. Without an engine plugin,
`new DisTube` throws unless another plugin has both `search` and `stream`.

## Other methods

`suggest(query, { signal })` returns at most 25 completions. An empty list declines. On a provider error, throw
like any other method, and `distube.suggest` propagates it.

`related(song, { signal, exclude })` receives the recent history Songs in `exclude`. Avoid returning one of them.
Autoplay calls it.

`dispose` joins your owned work and releases provider resources. Core calls it once, in reverse order of
`plugins`, during `distube.dispose()`.

## Errors

Use the core codes. `NOT_FOUND` for missing media, `UNAVAILABLE` for media that exists but cannot be played (age
restriction, private, region lock), `RATE_LIMITED` for throttling. Set `source` to your plugin's name.

```ts
import { DisTubeError, ErrorCode } from "distube";

function missing(name: string): DisTubeError {
  return new DisTubeError(ErrorCode.NOT_FOUND, "Track does not exist", { source: name });
}
void missing;
```

A thrown `DisTubeError` reaches the caller unchanged, including one from a second copy of the package, which
`DisTubeError.is` matches by name and code, with three exceptions. `INVALID_ARGUMENT`, `INVALID_STATE` and `ABORTED`
describe the caller's input, the queue and the caller's cancellation, so core re-wraps them as `SOURCE_FAILED` with
the original as `cause`. Do not throw them for provider failures. When the caller aborted the signal you received,
the caller gets `ABORTED` whatever you threw. Any other throw becomes `SOURCE_FAILED` with the original as
`cause` and `source` set to your `name`. Core does not scrub messages, so keep credentials, signed URLs and encoded
track data out of messages and causes. A bot checks `DisTubeError.is(error, ErrorCode.NOT_FOUND)` and reads
`error.source`.

## Song and playlist fields

A Song has `source`, `id`, `name` and canonical `url`, optional `duration` (seconds), `thumbnails` and `artist`, and
`pluginData`. `formattedDuration` is a getter. A Playlist has `source`, `id`, `name`, canonical `url`, optional
`thumbnails`, a non-empty ordered `songs` array, `pluginData`, and computed `duration` and `formattedDuration`.
Each source defines how it normalizes a missing duration.

List every image size the provider serves as `thumbnails`, each `{ url, width?, height? }`, from worst to best.
`thumbnail` reads the last entry, so put the original last. Leave out a size the provider does not report: an
unsized entry may sit anywhere, but known widths must not decrease, or the constructor throws `INVALID_ARGUMENT`.
Applications pick a size with `song.thumbnails.find(entry => (entry.width ?? Infinity) >= 300)`.

Put provider display data such as view counts, uploader names and live flags in `pluginData`. Core stores the
reference and never reads or freezes it. Keep signed URLs and temporary playback details out of it. They belong in
`stream` with a bounded lifetime. `new Song<ExampleData>(...)` requires `pluginData` unless the type allows
`undefined`. Caller metadata belongs to the QueueItem, not the Song.

Expand a collection to the `maxPlaylistSongs` value core passes in `resolve` options, in provider order. Stop requesting pages once you hold that many Songs, and return the first ones instead of rejecting. Check the `AbortSignal`
between pages, and drop an entry the provider marks unavailable instead of failing the page.

## Package boundaries

Keep authentication, URL policy, retries, metadata mapping and fixtures in the provider package. Import author
types with `import type` from `distube/integrations`, and the `Song`, `Playlist` and `DisTubeError` values from
`distube`. Plugins are fixed at construction, and there is no runtime registry. Plugin names must be unique. A
plugin instance can belong to one live client at a time.
