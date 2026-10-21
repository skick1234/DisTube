---
title: YouTube
description: "Install and configure @distube/youtube, covering search, playlists, playback and error codes."
---

Official YouTube `SourcePlugin` for DisTube v6, built on `@distube/ytdl-core`.

```sh
bun add @distube/youtube @distube/ytdl-core
```

`@distube/ytdl-core` is a peer dependency, like `distube`. npm 7+, Bun and pnpm install it automatically; install it
yourself with other package managers.

```ts
import { YouTubePlugin } from "@distube/youtube";
import { DisTube } from "distube";
import type { Adapter } from "distube/integrations";

declare const adapter: Adapter;

const youtube = new YouTubePlugin();
const distube = new DisTube({ adapter, sources: [youtube] });
const results = await youtube.search("DisTube tutorial");
const first = results[0];
if (first) await distube.play({ guildId: "guild", id: "voice" }, first);
```

## Configuring YouTube access

Every request the plugin makes goes through one `Ytdl` instance. Without the `ytdl` option the plugin builds
`new Ytdl()`. Pass your own to set a cookie, a PO token provider, a proxy `fetch`, the client order or the language,
and it applies to search, lookups, related videos, suggestions and playback alike:

```ts
import { YouTubePlugin } from "@distube/youtube";
import { createPoTokenProvider, Ytdl } from "@distube/ytdl-core";

declare const proxiedFetch: typeof fetch;

const getPoToken = await createPoTokenProvider({ fetch: proxiedFetch });
const youtube = new YouTubePlugin({
  ytdl: new Ytdl({ cookie: process.env.YOUTUBE_COOKIE, getPoToken, fetch: proxiedFetch }),
});
```

The plugin never disposes the instance. If you built a PO token provider, call its `dispose()` after the plugin's.
The plugin has no network policy options: it parses a YouTube URL locally to a video or playlist ID and passes only
IDs and queries to `Ytdl`, which requests YouTube's own origins and the media URLs YouTube issues.

## Media

`resolve(url, options?)` returns `Song | Playlist | undefined` for absolute YouTube URLs, the same ones
`@distube/ytdl-core` accepts. Watch, `youtu.be`, Shorts, embed (including `youtube-nocookie.com`), live and YouTube
Music video URLs resolve to one Song. A URL whose `list` parameter is a playlist ID resolves to one ordered Playlist
of at most **500 entries**; entries YouTube marks unplayable are left out. Watch later (`list=WL`) and Liked videos
(`list=LL`) are not playlist IDs, so a watch URL carrying one resolves to its video. Generated mixes and radio
(`list=RD...`) are session-generated rather than stable collections, so the plugin declines them as playlists and a
watch URL carrying one resolves to its video. Anything else, including bare IDs, declines with `undefined`.

`search(query, options?)` takes `SearchOptions`: an `AbortSignal`, a `limit` and a zero-based `offset`. The default
limit is **10** and the maximum is **20**, with `offset` up to 20. Search returns videos only, in YouTube's rank
order, so consecutive windows are disjoint. A window past the available results returns an empty list; an
out-of-range `limit` or `offset` rejects with `INVALID_ARGUMENT` before any request.

`related(song, { signal, exclude })` returns the first video from YouTube's related list that is neither the Song nor
a YouTube Song in `exclude`, or `undefined`. `suggest(query, { signal })` returns up to 25 autocomplete strings in
provider order; a provider failure resolves to an empty list and records one diagnostic.

Each Song keeps its canonical `https://youtu.be/<id>` URL and carries `name`, `artist`, `duration` in seconds and the
widest `https` thumbnail. `pluginData` is `YouTubeData`: `views`, `uploader` and `live`. A live video has `duration`
0 and `formattedDuration` reads `Live`. A Playlist's `pluginData` is `YouTubePlaylistData` with the owner as
`uploader`.

## Playback

`stream(song, { signal })` returns a `reader`, `timed` or `stream` resource; the engine opens its Readables from `ytdl.download`. It picks
the best audio-only format, or the best audio among formats with video when there is none, as with live streams.
ytdl-core resumes after YouTube cuts a stream off, waits out an enforced preroll and streams formats YouTube serves
only through SABR. The first playback of a video resolved from its URL reuses that lookup while it is unexpired;
every later playback looks it up again. Signed media URLs, cookies and PO tokens stay inside the `Ytdl` instance and
never reach the Song or the resource.

Opus is preferred. Non-live webm and mp4 formats are seekable, so seeking and mid-track filter changes work on the official
local engine. Live streams and other formats are not seekable; there seeking or changing filters mid-track rejects with
`UNSUPPORTED` and the track keeps playing. Filters set before a track starts still apply.

The Lavalink engine accepts only `encoded` and trusted `url` resources, so it cannot play this plugin's streams.
Lavalink deployments use the [Lavalink](../lavalink/) source for YouTube.

## Errors

Failures ytdl-core distinguishes reject with a `DisTubeError` carrying a `YouTubeErrorCode`, with the `YtdlError` as
`cause`:

| `YtdlErrorCode`                                                                                      | `YouTubeErrorCode`       |
| ---------------------------------------------------------------------------------------------------- | ------------------------ |
| `NOT_FOUND`                                                                                          | `YOUTUBE_NOT_FOUND`      |
| `PRIVATE`, `MEMBERS_ONLY`, `PREMIUM_ONLY`, `REGION_BLOCKED`, `NOT_STARTED`, `BOT_CHECK`, `NO_FORMAT` | `YOUTUBE_UNAVAILABLE`    |
| `AGE_RESTRICTED`                                                                                     | `YOUTUBE_AGE_RESTRICTED` |
| `RATE_LIMITED`                                                                                       | `YOUTUBE_RATE_LIMITED`   |

Narrow with `DisTubeError.is(error, YouTubeErrorCode.NOT_FOUND)`. Any other failure rejects with a plain `Error` that
keeps the `YtdlError` as `cause`, which core maps to `SOURCE_FAILED`. Caller cancellation and plugin disposal reject as
cancellation. A stream that fails after playback started errors on the `Readable` and reaches the Player as a track
failure.
