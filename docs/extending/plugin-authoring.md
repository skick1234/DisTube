---
title: Plugin authoring
description: Write a Plugin with typed pluginData and core error codes.
sidebar:
  order: 1
---

This page is for authors of source plugins. By the end of it you will have a plugin that resolves links from your own
site, searches it and streams its audio. Its Songs will carry typed `pluginData`, and its failures will use codes a bot
can act on.

## What a plugin is

A `Plugin` has a non-empty `name` and at least one of `resolve`, `search`, `stream` or `engine`. `related`, `suggest`
and `dispose` are optional, each on its own. Leave out what your provider cannot do. Do not add methods that do nothing.

Some shapes you might build:

- A plugin with only `stream` is valid. It plays Songs the application builds itself, such as
  [sound clips](../../popular-topics/soundboard/).
- A plugin that returns Songs but has no `stream` plays them through the [search fallback](#a-plugin-without-stream),
  or through an engine plugin's `prepare`.
- A search-only catalog implements `search` and leaves out `resolve`.

There is no `initialize` hook. A constructor only validates its options, and the first provider request happens on
first use.

## Build a source plugin

This plugin serves a tiny catalog from `example.audio`. A real one would call the provider's API in the same places:

```ts title="example-source.ts"
import { DisTubeError, ErrorCode, Song } from "distube";
import type { PlaybackResource, Plugin, SearchOptions } from "distube/integrations";

export interface ExampleData {
  readonly plays: number;
}

interface CatalogTrack {
  readonly name: string;
  readonly artist: string;
  readonly plays: number;
}

const catalog = new Map<string, CatalogTrack>([["1", { name: "Example track", artist: "Example artist", plays: 9 }]]);
const TRACK_URL = /^https:\/\/example\.audio\/track\/(\w+)$/u;
const SEARCH_MAX_LIMIT = 20;

export class ExampleSource implements Plugin<ExampleData> {
  readonly name = "example";

  async resolve(url: string): Promise<Song<ExampleData> | undefined> {
    const id = TRACK_URL.exec(url)?.[1];
    if (!id) return undefined;
    const track = catalog.get(id);
    if (!track) {
      throw new DisTubeError(ErrorCode.NOT_FOUND, "Track does not exist", { source: this.name, media: "song" });
    }
    return this.#song(id, track);
  }

  async search(query: string, { limit, offset }: SearchOptions): Promise<readonly Song<ExampleData>[]> {
    const needle = query.toLowerCase();
    return [...catalog]
      .filter(([, track]) => track.name.toLowerCase().includes(needle))
      .slice(offset, offset + Math.min(limit, SEARCH_MAX_LIMIT))
      .map(([id, track]) => this.#song(id, track));
  }

  async stream(song: Song<ExampleData>, { signal }: { readonly signal: AbortSignal }): Promise<PlaybackResource> {
    signal.throwIfAborted();
    return { kind: "url", url: `https://cdn.example.audio/${song.id}.mp3` };
  }

  #song(id: string, track: CatalogTrack): Song<ExampleData> {
    return new Song({
      source: this.name,
      id,
      name: track.name,
      artist: track.artist,
      url: `https://example.audio/track/${id}`,
      pluginData: { plays: track.plays },
    });
  }
}
```

A bot uses it like any official plugin, and the search results know their `pluginData` type:

```ts title="index.ts"
import { DiscordJSAdapter } from "@distube/discordjs";
import type { Client } from "discord.js";
import { DisTube } from "distube";
import { ExampleSource } from "./example-source.ts";

declare const client: Client;

const example = new ExampleSource();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [example] });

const results = await distube.search("example", { source: example });
const plays: number | undefined = results[0]?.pluginData.plays;
console.log(plays);
```

The rest of this page explains each part.

## Typed pluginData

Declare `Plugin<Data, ListData>` to type the `pluginData` of every Song and Playlist the plugin returns. Give a
Playlist the same two type arguments, `new Playlist<Data, ListData>({ ..., pluginData })`, and `resolve` returns
`Song<Data> | Playlist<Data, ListData> | undefined`.

A concrete `ListData` makes the Playlist's `pluginData` required at construction. Leave it out and Playlist data stays
`unknown`. Likewise, `new Song<ExampleData>(...)` requires `pluginData` unless the type allows `undefined`.

## Resolving links

`resolve` returns a Song, an ordered Playlist, or `undefined` to decline. Throw for a provider failure. Return `Song`
and `Playlist` values from `distube`, each with `source` equal to the plugin's `name`. Core rejects any other source
with `SOURCE_FAILED`.

Core decides which method a string reaches, as [plugins and their order](../../get-started/how-distube-works/#plugins-and-their-order)
describes. An application's input reaches `resolve` only when it is an `http` or `https` URL, and anything else is a
query. To serve your own URI scheme, such as `spotify:track:...`, accept it in `search`.

Expand a collection up to the `maxPlaylistSongs` value core passes in the `resolve` options, in provider order. Stop
requesting pages once you hold that many Songs, and return the first ones instead of rejecting. Check the
`AbortSignal` between pages. Drop an entry the provider marks unavailable instead of failing the page.

## Searching

`search(query, { signal, limit, offset })` receives a positive integer `limit` and a zero-based `offset`. Clamp `limit`
to your provider's maximum and document it in your package README. Return results in the provider's ranking, because
core never re-ranks across plugins. An empty array declines the query.

When an application calls `distube.search(query, { source })` on a plugin without `search`, the call rejects
`UNSUPPORTED`.

## How core uses each method

| Operation                          | Plugin declines                  | Plugin throws                           |
| ---------------------------------- | -------------------------------- | --------------------------------------- |
| URL given to `resolve`             | `undefined`: try the next plugin | Rejects                                 |
| Query for `play`, `add`, `resolve` | `[]`: try the next plugin        | Recorded, then the next plugin is tried |
| `distube.search`                   | `[]`: try the next plugin        | Rejects                                 |
| `distube.suggest`                  | `[]`: try the next plugin        | Rejects                                 |

[Plugins and their order](../../get-started/how-distube-works/#plugins-and-their-order) has the outcomes when every
plugin declines or fails. Core raises the code and `source` that every recorded failure shares. Say your plugin throws
a `DisTubeError` with `RATE_LIMITED` and `source` set, and the other plugins find nothing. The caller then gets
`RATE_LIMITED` with your `source`. See [when every plugin failed](../../reference/errors/#when-every-plugin-failed).

## Preparing a Song

`stream(song, { signal })` runs when a Song is about to play. Core calls the plugin named by `song.source`, and that
plugin returns a `PlaybackResource`. It is a fresh, single-use `url`, `file`, `stream`, `reader`, `timed` or `encoded`
resource. [Playback resources](../playback-resources/) has the shapes and cleanup rules.

A real provider reacquires its playback URL inside `stream` on every call, because signed URLs expire while a Song
waits in the queue. A `stream` that throws fails the item with `queue.item.failed`, and core tries no other plugin.

## A plugin without stream

Leave out `stream` when the provider serves metadata only, as Spotify does. Core then plays the Song through a search
fallback:

1. It builds the query from `song.name`, followed by `song.artist` when present.
2. It searches every other plugin that has both `search` and `stream`, in the order of `plugins`, with limit 1.
3. It prepares only the first candidate of each plugin through that plugin's `stream`, and stops at the first
   resource.

If nothing is found, the item fails `NO_RESULT`. If a search or stream failed, the item fails with the code every
failure shares, or `SOURCE_FAILED` when they differ, with an `AggregateError` of every failure as `cause`. When every
failure also carries the same `source`, the error carries it too. Queue state and events keep the original item and
Song.

Without an engine plugin, `new DisTube` throws unless another plugin has both `search` and `stream`.

## Engine plugins

Add an `engine` when the plugin plays media itself, as Lavalink does. Its `engine.prepare(song, { signal })` replaces
`stream` for every Song, and core calls no plugin's `stream`.

An engine plugin's `filters` map returns `label` as a string without the value, and the map becomes the application's
`distube.filters`. Implement `playbackRate(entries)` when a preset changes speed. Make the Player's `position` the
source time of the audio, so an application can extrapolate it with `queue.playbackRate`. The rules for `onClosed`,
pause and release are in [adapter authoring](../adapter-authoring/#engine-and-player).

## Other methods

`suggest(query, { signal })` returns completions for a partial query. Core uses at most 25 of them. An empty list
declines. On a provider error, throw like any other method, and `distube.suggest` passes the error on.

`related(song, { signal, exclude })` continues autoplay. `exclude` holds the Songs the queue played recently, so avoid
returning one of them.

`dispose` joins your owned work and releases provider resources. Core calls it once, in reverse order of `plugins`,
during `distube.dispose()`.

## Errors

Use the core codes. A plugin defines no codes of its own, so a distinction an application acts on needs one of these:

| Code             | Use it for                                                                         |
| ---------------- | ---------------------------------------------------------------------------------- |
| `NOT_FOUND`      | Media that does not exist                                                          |
| `UNAVAILABLE`    | Media that exists but cannot be played, such as private or region-locked media     |
| `AGE_RESTRICTED` | An age gate                                                                        |
| `RATE_LIMITED`   | Throttling                                                                         |
| `BOT_CHECK`      | A captcha or sign-in wall that refuses your client until it proves it is not a bot |
| `NOT_STARTED`    | Scheduled media, such as a premiere, that has not started                          |

`NOT_STARTED` carries no start time, so keep it in the `cause` you pass. Set `source` to your plugin's name. Set
`media` to `"song"` or `"playlist"` when the failure came from looking up one of them.

A `DisTubeError` you throw reaches the caller unchanged, even one from a second copy of the package, which
`DisTubeError.is` matches by name and code. Three codes are the exception: `INVALID_ARGUMENT`, `INVALID_STATE` and
`ABORTED`. They describe the caller's input, the queue and the caller's cancellation, so core re-wraps them as
`SOURCE_FAILED` with the original as `cause`. Do not throw them for provider failures.

When the caller aborted the signal you received, the caller gets `ABORTED` whatever you threw. Any other throw becomes
`SOURCE_FAILED`, with the original as `cause` and `source` set to your `name`. A bot then checks
`DisTubeError.is(error, ErrorCode.NOT_FOUND)` and reads `error.source`.

:::caution
Core does not scrub messages. Keep credentials, signed URLs and encoded track data out of your messages and causes,
because applications log them.
:::

## Song and Playlist fields

A Song has `source`, `id`, `name` and a canonical `url`. It may also have `duration` in seconds, `thumbnails`,
`artist`, `ageRestricted` and `pluginData`. `formattedDuration` is a getter that reads `Live` when the duration is
unknown or `0`. Each source decides how it fills in a missing duration.

Set `ageRestricted` to `true` when the provider marks the media for adults and `false` when it says it is not. Leave
it unset when the provider does not say. Core refuses a Song marked `true` unless the call passes
`allowAgeRestricted: true`, and looks up a single Song with an unknown answer through your `resolve` first.

A Playlist has `source`, `id`, `name`, a canonical `url`, optional `thumbnails`, a non-empty ordered `songs` array and
`pluginData`. Its `duration` and `formattedDuration` add up the Songs.

List every image size the provider serves as `thumbnails`, each `{ url, width?, height? }`, from worst to best.
`thumbnail` reads the last entry, so put the original last. Leave out a size the provider does not report. An unsized
entry may sit anywhere, but known widths must not decrease, or the constructor throws `INVALID_ARGUMENT`. Applications
pick a size with `song.thumbnails.find(entry => (entry.width ?? Infinity) >= 300)`.

Put provider display data, such as view counts, uploader names and live flags, in `pluginData`. Core stores the
reference and never reads or freezes it. Caller metadata belongs on the QueueItem, not the Song.

:::caution
Keep signed URLs and temporary playback details out of Song fields and `pluginData`. Applications show and log them.
They belong in `stream`, with a bounded lifetime.
:::

## Package boundaries

Keep authentication, URL policy, retries, metadata mapping and test fixtures in your plugin package. Import author
types with `import type` from `distube/integrations`, and the `Song`, `Playlist`, `DisTubeError` and `ErrorCode`
values from `distube`.

Plugins are fixed when the client is created, and there is no runtime registry. Plugin names must be unique, or
`new DisTube` throws `INVALID_ARGUMENT`. Give each client its own plugin instances, because `distube.dispose()`
disposes them.

## Next

Your `stream` returns a playback resource. [Playback resources](../playback-resources/) explains which kind to pick and
who cleans it up.
