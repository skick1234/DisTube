---
title: Spotify
description: Resolve Spotify metadata and play it through another source with @distube/spotify.
sidebar:
  order: 4
---

`@distube/spotify` resolves tracks, albums, playlists and artist top tracks, and searches Spotify metadata.
Short `spotify.link` and `spotify.app.link` links expand to the URL they share, which then resolves as if pasted.

## Install

Install alongside `distube` and your adapter. Include a playable source such as YouTube:

```sh title="npm"
npm install @distube/spotify @distube/youtube @distube/ytdl-core
```

```sh title="Bun"
bun add @distube/spotify @distube/youtube @distube/ytdl-core
```

## Example

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const youtube = new YouTubePlugin();
const spotify = new SpotifyPlugin();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [spotify, youtube] });
const results = await distube.search("artist track", { source: spotify, limit: 5 });
const first = results[0];
if (first) await distube.play(voiceChannel, first);
```

## Options and playback

`SpotifyPlugin` takes no options and no credentials. It always uses Spotify's anonymous web-player authentication. This unofficial method may stop working
or face rate limits.

Spotify has no `stream`, so core plays its Songs through the search fallback. It searches every other plugin that
has `search` and `stream`, in the order of `plugins`, for the track name and artists with limit 1, and plays the
first candidate that prepares. The public Song and queue item remain Spotify's; `queue.item.started` carries the
candidate as `fallback`, so you can show which video played. If every plugin finds nothing, the item fails
`NO_RESULT`; if some failed, it fails `SOURCE_FAILED` with an `AggregateError` of the failures. Either error carries
the searched text as `error.query`. The client
constructor rejects Spotify when no other plugin has `search` and `stream`. An engine plugin such as
[Lavalink](../lavalink/) prepares every Song itself and the fallback never runs.

Spotify has no `related` either. Autoplay after a Spotify Song asks the plugin that played the `fallback` instead,
seeded with that fallback Song, so a YouTube plugin adds a related video. The added item is that plugin's Song, not a
Spotify one. When the Spotify Song played with no fallback, as through Lavalink, autoplay publishes `queue.autoplay.failed`. An item
that failed is not used as the autoplay seed.

Songs expose `album`, `explicit` and `popularity` through typed `pluginData`. Search clamps `limit` to 50 and uses
a zero-based `offset`; an offset above 1000 returns no results. Playlists and albums keep their first
`maxPlaylistSongs` tracks. Provider failures are core `DisTubeError` instances with codes such as `NOT_FOUND`,
`UNAVAILABLE` and `RATE_LIMITED`, with `error.source` set to `"spotify"`. Each failure inside that `AggregateError`
keeps the code and source of the plugin that failed; none is a Spotify error. A failed track lookup carries
`error.media` `"song"`, and a failed playlist, album or artist lookup `"playlist"`. A refused token has none.

See the [quick start](../../get-started/quick-start/), [queue](../../reference/queue/) and
[errors](../../reference/errors/).
