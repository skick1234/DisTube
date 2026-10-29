---
title: yt-dlp
description: Play URLs from sites yt-dlp supports with @distube/yt-dlp.
sidebar:
  order: 5
---

`@distube/yt-dlp` resolves and plays URLs from any site that a yt-dlp site extractor supports, such as Bandcamp or Twitch.
It has no search, related tracks or suggestions.

## Install

Install alongside `distube` and your adapter:

```sh title="npm"
npm install @distube/yt-dlp
```

```sh title="Bun"
bun add @distube/yt-dlp
```

## Example

List it after the dedicated plugins, so YouTube, SoundCloud and Spotify resolve their own URLs first.

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { YtDlpPlugin } from "@distube/yt-dlp";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin(), new YtDlpPlugin()],
});
await distube.play(voiceChannel, "https://example.bandcamp.com/track/example");
```

## Options and playback

`YtDlpPluginOptions` has one optional field:

- `binary`: the path to a yt-dlp executable, version 2025.11.12 or later, run as is. The plugin never downloads or updates it.

Without `binary`, the first operation downloads the platform's standalone yt-dlp release from GitHub into the
package's `bin/` directory and checks its SHA-256 against the release's `SHA2-256SUMS`. On later process starts, yt-dlp
runs its own `--update` once before the first operation. No Python is needed. Supported platforms are Linux (glibc and
musl, x64 and arm64), macOS and Windows (x64, x86 and arm64). Any other platform rejects `UNSUPPORTED`, so set
`binary`. A read-only install such as a Docker image should set `binary` too.

yt-dlp reads its normal config files, so put cookies (`--cookies`), a proxy and similar settings there.
The plugin passes the running Node or Bun binary to yt-dlp as a JavaScript runtime, so YouTube extraction works without Deno.

Only `http` and `https` URLs resolve. The generic extractor is off, so a page no site extractor supports, and a direct
file link, declines without a request and the next plugin gets it. A playlist is capped at `maxPlaylistSongs`, and a
collection of collections, such as a YouTube channel's tabs, plays their entries in order.
Songs expose `extractor`, `live`, and `views` and `likes` when the site reports them, through typed `pluginData`.
`song.ageRestricted` is true when the site's `age_limit` is 18 or more and absent on flat playlist entries.
Playlists expose `extractor`.

Playback asks yt-dlp for the best audio format that is not DASH and hands its URL to the engine as a `url` resource,
as v5 did. It prefers audio-only formats, Opus first because the engine can play Opus without re-encoding, and otherwise the
lowest video resolution that carries the best audio. HLS formats, including most live streams, play on the built-in engine. Media offered only as DASH rejects
`UNSUPPORTED`, and sites whose media URLs need cookies or headers fail to play. Plain-HTTP formats seek when their server serves byte ranges; HLS formats do not. With Lavalink, the node loads the Song's page URL
itself and this step is skipped.

Failures are core `DisTubeError` instances with `error.source` set to `"yt-dlp"`. The message is yt-dlp's last `ERROR:`
line with every URL cut to its origin, and the code is `NOT_FOUND`, `UNAVAILABLE`, `AGE_RESTRICTED`, `RATE_LIMITED`, `UNSUPPORTED` or `SOURCE_FAILED`. An age gate the site keeps
without cookies is `AGE_RESTRICTED`.
See the [quick start](../../get-started/quick-start/), [queue](../../reference/queue/) and
[errors](../../reference/errors/).
