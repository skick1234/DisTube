---
title: Plugin authoring
description: Write a Plugin with typed pluginData and core error codes.
sidebar:
  order: 7
---

A `Plugin` has a non-empty `name` and at least one of `resolve`, `search` or `engine`. `stream`, `related`,
`suggest` and `dispose` are independently optional. A plugin that returns Songs needs `stream`, unless an engine
plugin prepares every Song. There is no `initialize` hook: constructors validate options only, and the first
provider request happens on first use. Do not add no-op methods for missing capabilities.

Declare `Plugin<Data>` to type the `pluginData` of every Song. Return `Song` and `Playlist` values from `distube`.
Each one must have `source` equal to the plugin's `name`. `resolve` returns a Song, an ordered Playlist or
`undefined` to decline. Throw for a provider failure.

Core decides which method a string reaches. An absolute `http:` or `https:` URL goes to `resolve`. Every other
non-empty string is a query and goes to `search`. That includes a provider URI such as `spotify:track:…`, which
core cannot tell from a query like `artist: song title`. Accept your URI scheme in `search` if you want to serve it.
A URL every plugin declines rejects `NO_RESULT`, and core does not retry it as a query.

```ts
import { Song } from "distube";
import type { PlaybackPreparation, Plugin } from "distube/integrations";

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

  async stream(_song: Song<ExampleData>, options: { readonly signal: AbortSignal }): Promise<PlaybackPreparation> {
    options.signal.throwIfAborted();
    return {
      kind: "resource",
      resource: { kind: "url", url: "https://cdn.example/audio.mp3", seekable: true },
    };
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
| `getSuggestions`                   | `[]`: try the next plugin        | Rejects                                 |

A query takes the first Song of the first non-empty answer. When no plugin answers it rejects `NO_RESULT`. When
some threw and none answered, it rejects `SOURCE_FAILED` with the failures in an `AggregateError` cause. An
absolute URL no plugin resolves rejects `NO_RESULT`.

## Preparing a Song

`stream(song, { signal })` runs when a Song is about to play. Core calls the plugin named by `song.source`, and
that plugin returns one of two shapes.

- `{ kind: "resource", resource }` is a fresh, single-use `url`, `file`, `stream`, `reader`, `timed` or `encoded`
  resource. See [direct inputs](../direct-inputs/) for the shapes and cleanup rules.
- `{ kind: "search", query }` asks core to find the Song elsewhere. Core searches the other plugins in order,
  takes the first result of each, and plays the first one whose `stream` returns a resource. A candidate that
  answers with another search request is skipped. Spotify uses this form. Exhaustion with no failures rejects
  `NO_RESULT`, otherwise `SOURCE_FAILED`.

The Player only borrows the resource. `voice.play` disposes it exactly once, and core disposes it when it drops a
prepared item before playback. Put temporary files or sockets in `dispose`.

Add an `engine` when the plugin plays media itself, as Lavalink does. See
[adapter authoring](../adapter-authoring/#engine-plugins). Its `engine.prepare(song, { signal, stream })` replaces
`stream` for every Song, and `stream` calls the owning plugin when that is a different plugin.

## Other methods

`suggest(query, { signal })` returns at most 25 completions. An empty list declines. On a provider error, throw
like any other method, and `getSuggestions` propagates it.

`related(song, { signal, exclude })` receives the recent history Songs in `exclude`. Avoid returning one of them.
`queue.addRelated()` and autoplay both call it.

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

A thrown `DisTubeError` reaches the caller unchanged. Any other throw becomes `SOURCE_FAILED` with the original as
`cause` and `source` set to your `name`. Core does not scrub messages, so keep credentials, signed URLs and encoded
track data out of messages and causes. A bot checks `DisTubeError.is(error, ErrorCode.NOT_FOUND)` and reads
`error.source`.

## Song and playlist fields

A Song has `source`, `id`, `name` and canonical `url`, optional `duration` (seconds), `thumbnail` and `artist`, and
`pluginData`. `formattedDuration` is a getter. A Playlist has `source`, `id`, `name`, canonical `url`, optional
`thumbnail`, a non-empty ordered `songs` array, `pluginData`, and computed `duration` and `formattedDuration`.
Each source defines how it normalizes a missing duration.

Put provider display data such as view counts, uploader names and live flags in `pluginData`. Core stores the
reference and never reads or freezes it. Keep signed URLs and temporary playback details out of it. They belong in
`stream` with a bounded lifetime. `new Song<ExampleData>(...)` requires `pluginData` unless the type allows
`undefined`. Caller metadata belongs to the QueueItem, not the Song.

Expand a collection to a bound you document in the package README, in provider order. Check the `AbortSignal`
between pages, and drop an entry the provider marks unavailable instead of failing the page.

## Package boundaries

Keep authentication, URL policy, retries, metadata mapping and fixtures in the provider package. Import author
types with `import type` from `distube/integrations`, and the `Song`, `Playlist` and `DisTubeError` values from
`distube`. Plugins are fixed at construction, and there is no runtime registry. Plugin names must be unique. A
plugin instance can belong to one live client at a time.
